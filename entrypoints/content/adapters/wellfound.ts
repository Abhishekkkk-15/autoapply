import { JobPlatformAdapter, type SearchCardInfo } from './base';
import type {
  ScrapedJob,
  UserProfile,
  ApplyStepResult,
  Platform,
  CustomQuestionAnswer,
} from '@/src/lib/types';
import {
  simulateClick,
  setNativeValue,
  randomDelay,
  waitForSelector,
} from '@/src/lib/dom-utils';
import { extractContactsFromJob } from '@/src/lib/extractor';
import { generatePitchAndLetter } from '@/src/lib/ai';

export class WellfoundAdapter extends JobPlatformAdapter {
  readonly platform: Platform = 'wellfound';
  private selectedCard: HTMLElement | null = null;
  private selectedJob: ScrapedJob | null = null;

  isMatch(): boolean {
    const host = window.location.hostname;
    return host.includes('wellfound.com') || host.includes('angel.co');
  }

  cleanCompanyName(raw: string): string {
    if (!raw) return 'Startup';
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/Actively Hiring/gi, '');
    cleaned = cleaned.replace(/\d+(?:-\d+|\+)?\s*Employees?/gi, '');
    cleaned = cleaned.replace(/Seed|Series [A-Z]|Bootstrapped/gi, '');
    cleaned = cleaned.replace(/\s+/g, ' ');
    const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      cleaned = lines[0];
    }
    if (cleaned.length > 45 && cleaned.includes('.')) {
      cleaned = cleaned.split('.')[0].trim();
    }
    cleaned = cleaned.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
    return cleaned.trim() || 'Startup';
  }

  extractCompanyName(container: HTMLElement | Document): string {
    const specificHeading = container.querySelector<HTMLElement>(
      '[data-test="StartupName"], a[href*="/company/"] h2, a[href*="/company/"] h3, [data-test="StartupResult"] h2, [data-test="StartupResult"] h3, .styles_companyName__3p, h2[class*="company"], h2[class*="startup"]'
    );
    if (specificHeading?.textContent?.trim()) {
      return this.cleanCompanyName(specificHeading.textContent);
    }

    if (container !== document) {
      const h2 = container.querySelector<HTMLElement>('h2, h3');
      if (h2?.textContent?.trim()) {
        const text = h2.textContent.trim();
        if (!text.toLowerCase().includes('search for jobs') && !text.toLowerCase().startsWith('jobs in')) {
          return this.cleanCompanyName(text);
        }
      }
    }

    const compEl = container.querySelector<HTMLElement>('a[href*="/company/"]');
    if (compEl) {
      const firstChildEl = compEl.querySelector('h2, h3, h4, span, strong, div');
      if (firstChildEl?.textContent?.trim()) {
        const text = firstChildEl.textContent.trim();
        if (text.length > 1 && text.length < 50 && !text.toLowerCase().includes('actively hiring')) {
          return this.cleanCompanyName(text);
        }
      }
      return this.cleanCompanyName(compEl.textContent || '');
    }

    return 'Startup';
  }

  cleanJobTitle(raw: string): string {
    if (!raw) return 'Software Engineer';
    let cleaned = raw.replace(/\r/g, '').trim();
    const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      cleaned = lines[0];
    }
    cleaned = cleaned.replace(/(?:Onsite or remote|Remote only|Remote|In office|Hybrid|Everywhere|India|Bengaluru|Bangalore|Mumbai|Pune|Delhi)[\s\S]*/i, '');
    cleaned = cleaned.replace(/(?:₹|\$|\d+L|\d+k|No equity|\d+%\s*–\s*\d+%)[\s\S]*/i, '');
    cleaned = cleaned.replace(/(?:Recruiter recently active|Posted\s+.*|icn_.*)[\s\S]*/i, '');
    cleaned = cleaned.replace(/^[\s\-–—|•]+|[\s\-–—|•]+$/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned || lines[0] || 'Software Engineer';
  }

  extractFullJobDetails(card?: HTMLElement): ScrapedJob | null {
    try {
      // 1. Details container (drawer, modal dialog, or main page)
      const detailsContainer =
        document.querySelector<HTMLElement>(
          '[data-test="JobDetailModal"], div[role="dialog"], div[aria-modal="true"], aside, div[class*="drawer"], div[class*="sheet"], div[class*="JobDetail"], [data-test="JobListing"]'
        ) ||
        document.querySelector<HTMLElement>('main') ||
        document.body;

      // 2. Clean Title
      let rawTitle = '';
      if (detailsContainer && detailsContainer !== document.body) {
        const titleEl = detailsContainer.querySelector<HTMLElement>(
          '[data-test="JobTitle"], h1, h2, .styles_title__2_jV3'
        );
        if (titleEl?.textContent?.trim()) {
          rawTitle = titleEl.textContent.trim();
        }
      }
      if (!rawTitle && card) {
        const cardTitleEl = card.querySelector<HTMLElement>(
          '[data-test="JobTitle"], a[href*="/jobs/"], .styles_title__2_jV3, span[class*="title"], h3, h4'
        );
        rawTitle = cardTitleEl?.textContent?.trim() || '';
      }
      if (!rawTitle) {
        const docTitle = document.querySelector<HTMLElement>(
          '[data-test="JobTitle"], h1[class*="title"], h1, .text-xl.font-semibold'
        );
        rawTitle = docTitle?.textContent?.trim() || '';
      }
      const title = this.cleanJobTitle(rawTitle);

      // 3. Clean Company Name
      const startupContainer = card
        ? card.closest<HTMLElement>('[data-test="StartupResult"], div[class*="styles_result__"]') || card
        : detailsContainer;
      const company = this.extractCompanyName(startupContainer || document);

      // 4. Location
      let location = 'Remote';
      const locEl =
        detailsContainer?.querySelector<HTMLElement>(
          '[data-test="JobLocation"], .styles_location__3B, .text-sm.text-neutral-500'
        ) ||
        card?.querySelector<HTMLElement>(
          '[data-test="JobLocation"], .styles_location__3B, span[class*="location"], .text-sm.text-neutral-500'
        );
      if (locEl?.textContent?.trim()) {
        location = locEl.textContent.trim();
      }

      // 5. Complete, Un-Cut Job Description & Details
      const descSections: string[] = [];

      // A. Company Description / Overview
      const companyDescEl = detailsContainer?.querySelector<HTMLElement>(
        '[data-test="CompanyDescription"], div[class*="styles_aboutCompany__"], div[class*="aboutCompany"]'
      );
      if (companyDescEl?.textContent?.trim()) {
        descSections.push(`About ${company}:\n${companyDescEl.textContent.trim()}`);
      }

      // B. Dedicated Job Description Containers
      const descEls = Array.from(
        (detailsContainer || document).querySelectorAll<HTMLElement>(
          '[data-test="JobDescription"], .styles_description__3w17, div[class*="styles_description__"], div[class*="description"], div[class*="styles_body__"], div[class*="jobDescription"], section[class*="description"]'
        )
      );

      const seenTexts = new Set<string>();
      for (const el of descEls) {
        const txt = el.textContent?.trim();
        if (txt && txt.length > 40 && !seenTexts.has(txt)) {
          seenTexts.add(txt);
          descSections.push(txt);
        }
      }

      // C. Fallback: Full text of the drawer container
      if (descSections.length === 0 || descSections.join('\n\n').length < 150) {
        if (detailsContainer && detailsContainer !== document.body) {
          const clone = detailsContainer.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll(
              'button, svg, nav, footer, script, style, [data-test="ReportButton"], [data-test="SaveButton"], [data-test="CloseButton"]'
            )
            .forEach((n) => n.remove());
          const fullText = clone.textContent?.replace(/\s+/g, ' ').trim();
          if (fullText && fullText.length > 50) {
            descSections.push(fullText);
          }
        }
      }

      // D. Skills tags
      const skillEls = Array.from(
        (detailsContainer || document).querySelectorAll<HTMLElement>(
          '[data-test="JobSkills"] span, div[class*="styles_skills__"] span, div[class*="skills"] span, span[class*="styles_tag__"]'
        )
      );
      const skills = Array.from(
        new Set(
          skillEls
            .map((s) => s.textContent?.trim())
            .filter((s): s is string => !!s && s.length > 1 && s.length < 40)
        )
      );
      if (skills.length > 0) {
        descSections.push(`Required/Desired Skills: ${skills.join(', ')}`);
      }

      let jobDescription = descSections.join('\n\n').trim();
      if (!jobDescription) {
        jobDescription = `${title} at ${company}. Location: ${location}`;
      }

      // 6. External Job ID
      let externalJobId = '';
      const match = window.location.pathname.match(/\/jobs\/(\d+)/);
      if (match) {
        externalJobId = match[1];
      } else {
        const link =
          detailsContainer?.querySelector<HTMLAnchorElement>('a[href*="/jobs/"]') ||
          card?.querySelector<HTMLAnchorElement>('a[href*="/jobs/"]');
        const m = link?.href?.match(/\/jobs\/(\d+)/);
        if (m) externalJobId = m[1];
      }
      if (!externalJobId && card?.getAttribute('data-job-id')) {
        externalJobId = card.getAttribute('data-job-id')!;
      }
      if (!externalJobId && this.selectedJob?.externalJobId) {
        externalJobId = this.selectedJob.externalJobId;
      }
      if (!externalJobId) {
        externalJobId = `wf_${Math.abs(hash(title + '_' + company))}`;
      }

      // 7. Contacts & Recruiter
      const contacts = extractContactsFromJob(
        jobDescription,
        detailsContainer?.querySelector('[data-test="RecruiterCard"], div[class*="recruiter"]') || undefined
      );

      // 8. Posted Date
      let postedDate = this.extractPostedDate();
      if (!postedDate && card) {
        const dateEl = card.querySelector(
          '[data-test="JobListingPostingDate"], time, span[class*="listingDate"], span[class*="posted"]'
        );
        postedDate = dateEl?.textContent?.trim() || '';
      }

      // 9. In-Platform Apply Check
      const canEasyApply =
        !!this.findApplyButton(detailsContainer) ||
        !!this.findApplyButton(card || document) ||
        detailsContainer?.textContent?.toLowerCase().includes('apply on wellfound') ||
        card?.textContent?.toLowerCase().includes('apply on wellfound') ||
        false;

      return {
        platform: 'wellfound',
        externalJobId,
        title,
        company,
        location,
        jobUrl: window.location.href,
        jobDescription,
        extractedContacts: contacts,
        canEasyApply,
        postedDate: postedDate || undefined,
      };
    } catch (err) {
      console.error('[Wellfound] Error extracting full job details:', err);
      return null;
    }
  }

  async parseCurrentJob(): Promise<ScrapedJob | null> {
    try {
      const isStandaloneJobPage = !!window.location.pathname.match(/\/jobs\/(\d+)/);
      if (!isStandaloneJobPage && this.selectedJob && this.selectedJob.jobDescription?.length > 100) {
        return this.selectedJob;
      }

      const job = this.extractFullJobDetails(this.selectedCard || undefined);
      if (job) {
        this.selectedJob = job;
        return job;
      }
      return null;
    } catch (err) {
      console.error('[Wellfound] Error parsing job:', err);
      return null;
    }
  }

  private extractPostedDate(): string {
    const selectors = [
      '[data-test="JobListingPostingDate"]',
      'span[class*="listingDate"]',
      'span[class*="posted"]',
      'span[class*="styles_posted"]',
      'time',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of Array.from(els)) {
        const text = el.textContent?.trim() || '';
        if (
          /(?:ago|posted|active|today|just posted|\d+[wdm])/i.test(text) &&
          !text.includes('$') &&
          text.length < 50
        ) {
          return text;
        }
      }
    }
    return '';
  }

  canAutoApply(): boolean {
    if (this.selectedCard) {
      const text = this.selectedCard.textContent?.toLowerCase() || '';
      return (
        text.includes('apply on wellfound') ||
        text.includes('learn more') ||
        !!this.findApplyButton(this.selectedCard) ||
        !!this.findApplyButton(document)
      );
    }
    return !!this.findApplyButton();
  }

  findApplyButton(container: HTMLElement | Document = document): HTMLElement | null {
    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button[data-test="ApplyButton"], button[data-test="QuickApplyButton"], button[data-test*="apply" i], button, a[role="button"], a[data-test*="apply" i], a[class*="apply" i], a'
      )
    );
    for (const b of buttons) {
      if (b.offsetWidth === 0 && b.offsetHeight === 0 && b.getClientRects().length === 0) continue;
      const text = b.textContent?.trim().toLowerCase() || '';
      const test = b.getAttribute('data-test')?.toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      const href = (b as HTMLAnchorElement).href || '';

      // Skip search URLs, pagination, or navigation tabs
      if (href.includes('/jobs?')) continue;
      if (
        text.includes('application') ||
        text.includes('applied') ||
        text.includes('save') ||
        text.includes('saved')
      ) {
        continue;
      }

      if (
        test.includes('apply') ||
        aria.includes('apply') ||
        text === 'apply' ||
        text === 'quick apply' ||
        text === 'easy apply' ||
        text.startsWith('apply') ||
        (text.includes('apply') && text.length < 35)
      ) {
        return b;
      }
    }
    return null;
  }

  private findNoteInput(): HTMLTextAreaElement | HTMLElement | null {
    // 1. Check inside visible dialog or application container
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test="ApplyModal"], [data-test*="Modal"], div[role="dialog"], div[aria-modal="true"], form, div[class*="drawer"]'
      )
    );
    for (const d of dialogs) {
      const ta = d.querySelector<HTMLTextAreaElement>(
        'textarea[name*="note"], textarea[placeholder*="note"], textarea[placeholder*="Why"], textarea[placeholder*="interest"], textarea'
      );
      if (ta && (ta.offsetParent !== null || ta.getClientRects().length > 0)) {
        return ta;
      }
    }

    // 2. Fallback: check any visible textarea in document
    const allTextareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'));
    for (const ta of allTextareas) {
      if (ta.offsetParent !== null || ta.getClientRects().length > 0) {
        return ta;
      }
    }

    // 3. Fallback: check contenteditable
    const editables = Array.from(document.querySelectorAll<HTMLElement>('div[contenteditable="true"]'));
    for (const ed of editables) {
      if (ed.offsetParent !== null || ed.getClientRects().length > 0) {
        return ed;
      }
    }

    return null;
  }

  private findApplyModal(): HTMLElement | null {
    // 1. If note input is currently visible, its closest container is the application form/modal
    const noteInput = this.findNoteInput();
    if (noteInput) {
      const container = noteInput.closest<HTMLElement>(
        '[data-test="ApplyModal"], [data-test*="Modal"], div[role="dialog"], div[aria-modal="true"], form, aside, div[class*="drawer"], div[class*="sheet"], div[class*="modal"], div[class*="result"], div[class*="jobListing"], div[data-test="JobListing"]'
      );
      if (container) return container;
      if (noteInput.parentElement?.parentElement) {
        return noteInput.parentElement.parentElement as HTMLElement;
      }
    }

    // 2. Otherwise search document for dialog/drawer/modal elements
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test="ApplyModal"], [data-test*="Modal"], div[role="dialog"], div[aria-modal="true"], form, aside, div[class*="drawer"], div[class*="sheet"], div[class*="modal"]'
      )
    );
    for (const d of dialogs) {
      if (
        d.querySelector('textarea, div[contenteditable="true"]') ||
        d.querySelector('button[type="submit"]') ||
        d.textContent?.toLowerCase().includes('send application') ||
        d.textContent?.toLowerCase().includes('apply to')
      ) {
        return d;
      }
    }
    return null;
  }

  findSubmitButton(modal?: HTMLElement | null): HTMLElement | null {
    // 1. Determine best container: explicit modal, or container around note input, or document
    let container = modal || this.findApplyModal();
    if (!container) {
      const noteInput = this.findNoteInput();
      if (noteInput) {
        container = noteInput.closest<HTMLElement>(
          'form, [data-test="ApplyModal"], div[role="dialog"], div[aria-modal="true"], aside, div[class*="drawer"], div[class*="sheet"], div[class*="modal"], div'
        );
      }
    }

    const searchRoots = container ? [container, document] : [document];

    for (const root of searchRoots) {
      const buttons = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button[data-test="SubmitButton"], button[data-test*="Submit"], button[data-test*="submit"], button[data-test="SendButton"], button[data-test="QuickApplyButton"], button[data-test="ApplyButton"], button[type="submit"], input[type="submit"], button, a[role="button"]'
        )
      );

      for (const b of buttons) {
        if (b.offsetWidth === 0 && b.offsetHeight === 0 && b.getClientRects().length === 0) continue;

        const txt = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        const dataTest = b.getAttribute('data-test')?.toLowerCase() || '';
        const combined = `${txt} ${aria} ${dataTest}`;

        // Reject non-submit actions
        if (
          combined.includes('back') ||
          combined.includes('cancel') ||
          combined.includes('close') ||
          combined.includes('dismiss') ||
          combined.includes('save') ||
          combined.includes('share') ||
          combined.includes('edit')
        ) {
          continue;
        }

        // If inside the form/modal and has type="submit" or data-test containing submit
        if (root !== document && (b.getAttribute('type') === 'submit' || dataTest.includes('submit') || dataTest.includes('send'))) {
          return b;
        }

        // Check text and aria patterns
        const isSubmitText =
          txt === 'send' ||
          txt === 'apply' ||
          txt === 'submit' ||
          txt.startsWith('send ') ||
          txt.startsWith('apply ') ||
          txt.startsWith('submit ') ||
          combined.includes('send application') ||
          combined.includes('submit application') ||
          combined.includes('send note') ||
          combined.includes('send pitch') ||
          combined.includes('apply now') ||
          combined.includes('apply to') ||
          combined.includes('quick apply');

        if (isSubmitText) {
          return b;
        }
      }
    }

    return null;
  }

  async executeApplyStep(
    profile: UserProfile,
    isSemiAuto: boolean,
    customOptions?: {
      customPitch?: string;
      customCoverLetter?: string;
      customAnswers?: CustomQuestionAnswer[];
    }
  ): Promise<ApplyStepResult> {
    const job = this.selectedJob || (await this.parseCurrentJob());
    if (!job) {
      return { status: 'FAILED', message: 'Could not scrape job details on Wellfound.' };
    }

    // Check preference filtering
    const prefCheck = this.matchesPreferences(job, profile);
    if (!prefCheck.allow) {
      return { status: 'SKIPPED', message: prefCheck.reason || 'Skipped per user preferences.' };
    }

    // 1. Check if note input is already open or click Apply button
    let noteInput = this.findNoteInput();
    let modal = this.findApplyModal();

    if (!noteInput) {
      // 1. If Apply button is not already visible, open the job post first!
      let applyBtn = this.findApplyButton(document);

      if (!applyBtn && this.selectedCard) {
        await this.openJobPost(this.selectedCard);
      }

      // 2. Poll up to 4.5 seconds for the Apply button in the opened job post
      for (let i = 0; i < 9; i++) {
        applyBtn = this.findApplyButton(document);
        if (applyBtn) break;
        await randomDelay(400, 600);
      }

      if (!applyBtn) {
        return { status: 'NO_EASY_APPLY', message: 'No active Apply button found in opened job post on Wellfound.' };
      }

      await simulateClick(applyBtn);
      await randomDelay(1200, 2000);

      // Wait up to 5 seconds for note input or modal to appear
      for (let i = 0; i < 10; i++) {
        noteInput = this.findNoteInput();
        modal = this.findApplyModal();
        if (noteInput || modal) break;
        await randomDelay(400, 600);
      }
    }

    modal = modal || (noteInput ? (noteInput.closest('div[role="dialog"], form, aside, div[class*="modal"]') as HTMLElement) : null);

    // 2. Prepare pitch note & cover letter
    let pitchNote = customOptions?.customPitch?.trim() || '';
    let coverLetter = customOptions?.customCoverLetter?.trim() || '';
    if (!pitchNote) {
      const generated = await generatePitchAndLetter(profile, job);
      pitchNote = generated.pitchNote;
      coverLetter = generated.coverLetter;
    }

    // 3. Inject pitch note
    if (noteInput && pitchNote) {
      try {
        noteInput.focus();
        await randomDelay(100, 250);
        if (noteInput instanceof HTMLTextAreaElement || noteInput instanceof HTMLInputElement) {
          setNativeValue(noteInput, pitchNote);
        } else if (noteInput.isContentEditable) {
          noteInput.textContent = pitchNote;
          noteInput.dispatchEvent(new Event('input', { bubbles: true }));
          noteInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await randomDelay(400, 800);
      } catch (err) {
        console.warn('[Wellfound] Failed to inject pitch note:', err);
      }
    }

    // 4. Semi-Auto mode: halt for user confirmation
    if (isSemiAuto) {
      if (modal) modal.style.outline = '4px solid #10b981';
      return {
        status: 'PENDING_APPROVAL',
        needsUserApproval: true,
        stepName: 'Wellfound Note Review',
        message: noteInput
          ? 'Tailored 150-word pitch injected into Wellfound note. Awaiting review to submit.'
          : 'Application opened. Ready for review.',
        artifacts: { pitchNote, coverLetter },
      };
    }

    // 5. Full-Auto mode: find and click Submit button
    const submitBtn = this.findSubmitButton(modal);
    if (submitBtn) {
      await simulateClick(submitBtn);
      await randomDelay(1500, 2500);
      return {
        status: 'SUBMITTED',
        message: 'Application submitted on Wellfound with custom tailored pitch.',
        artifacts: { pitchNote, coverLetter },
      };
    }

    return {
      status: 'STEP_ADVANCED',
      message: 'Pitch injected; ready for submission.',
      artifacts: { pitchNote, coverLetter },
    };
  }

  /**
   * Directly submits an application modal that is currently paused at the review step on Wellfound.
   */
  async submitPendingApproval(profile: UserProfile): Promise<ApplyStepResult> {
    // 1. Ensure pitch note is injected if note input is present and empty
    const noteInput = this.findNoteInput();
    if (noteInput) {
      const currentVal =
        noteInput instanceof HTMLTextAreaElement || noteInput instanceof HTMLInputElement
          ? noteInput.value
          : noteInput.textContent || '';

      if (!currentVal.trim()) {
        const job: ScrapedJob = this.selectedJob || (await this.parseCurrentJob()) || {
          platform: 'wellfound',
          externalJobId: 'wf_temp',
          title: 'Software Engineer',
          company: 'Startup',
          location: 'Remote',
          jobUrl: window.location.href,
          jobDescription: '',
          extractedContacts: { emails: [] },
          canEasyApply: true,
        };
        const { pitchNote } = await generatePitchAndLetter(profile, job);
        if (pitchNote) {
          noteInput.focus();
          await randomDelay(100, 200);
          if (noteInput instanceof HTMLTextAreaElement || noteInput instanceof HTMLInputElement) {
            setNativeValue(noteInput, pitchNote);
          } else {
            noteInput.textContent = pitchNote;
            noteInput.dispatchEvent(new Event('input', { bubbles: true }));
            noteInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await randomDelay(300, 600);
        }
      }
    }

    // 2. Locate the submit button (with retries for dynamic animations)
    const modal = this.findApplyModal();
    let submitBtn = this.findSubmitButton(modal);

    if (!submitBtn) {
      for (let i = 0; i < 6; i++) {
        await randomDelay(300, 500);
        submitBtn = this.findSubmitButton(modal || this.findApplyModal());
        if (submitBtn) break;
      }
    }

    if (submitBtn) {
      // If disabled, dispatch input/change events to trigger form validity
      if (submitBtn.hasAttribute('disabled') || submitBtn.getAttribute('aria-disabled') === 'true') {
        if (noteInput) {
          noteInput.dispatchEvent(new Event('input', { bubbles: true }));
          noteInput.dispatchEvent(new Event('change', { bubbles: true }));
          noteInput.blur();
          await randomDelay(300, 600);
        }
      }

      await simulateClick(submitBtn);
      await randomDelay(1800, 2800);

      await this.closeSuccessModalIfOpen();

      // Clear selection references
      this.selectedCard = null;
      this.selectedJob = null;

      return {
        status: 'SUBMITTED',
        message: 'Application submitted successfully on Wellfound.',
      };
    }

    // Fallback: If submit button still not directly found, try executing full-auto apply step
    return this.executeApplyStep(profile, false);
  }

  private async closeSuccessModalIfOpen(): Promise<void> {
    await randomDelay(1000, 1800);
    const dismissBtns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label="Close"], button[aria-label="Dismiss"], button[data-test="CloseModalButton"], button[data-test*="close"], button.styles_closeButton__'
      )
    );
    for (const btn of dismissBtns) {
      if (btn.offsetWidth > 0 || btn.offsetHeight > 0 || btn.getClientRects().length > 0) {
        await simulateClick(btn);
        break;
      }
    }
  }

  private async closeAnyOpenModal(): Promise<void> {
    const dismissBtns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label="Close"], button[aria-label="Dismiss"], button[data-test="CloseModalButton"], button[data-test*="close"], button.styles_closeButton__, [data-test="Modal"] button[aria-label="Close"]'
      )
    );
    for (const btn of dismissBtns) {
      if (btn.offsetWidth > 0 || btn.offsetHeight > 0 || btn.getClientRects().length > 0) {
        await simulateClick(btn);
        await randomDelay(400, 700);
        break;
      }
    }
  }

  private getJobCardElements(): HTMLElement[] {
    // 1. Look for individual job listings inside startup containers or list items
    const jobListings = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test="JobListing"], div[class*="styles_jobListing__"], div[data-test="job-listing"], div.styles_jobListing__'
      )
    );
    if (jobListings.length > 0) {
      return jobListings;
    }

    // 2. Look for job links inside startup results
    const jobLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[data-test="StartupResult"] a[href*="/jobs/"], div[class*="styles_result__"] a[href*="/jobs/"]'
      )
    );
    if (jobLinks.length > 0) {
      const cards: HTMLElement[] = [];
      for (const link of jobLinks) {
        const container =
          link.closest<HTMLElement>(
            '[data-test="JobListing"], div[class*="styles_jobListing__"], [data-test="StartupResult"], div[class*="styles_result__"]'
          ) || (link.parentElement as HTMLElement);
        if (container && !cards.includes(container)) {
          cards.push(container);
        }
      }
      if (cards.length > 0) return cards;
    }

    // 3. Fallback: startup result containers
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test="StartupResult"], div[class*="styles_result__"]'
      )
    );
  }

  getSearchResultCards(): SearchCardInfo[] {
    const rawCards = this.getJobCardElements();
    const cards: SearchCardInfo[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawCards.length; i++) {
      const card = rawCards[i];
      // Job title: must NOT pick h2 if h2 is startup name
      const titleEl = card.querySelector<HTMLElement>(
        '[data-test="JobTitle"], a[href*="/jobs/"], .styles_title__2_jV3, span[class*="title"], h3[class*="title"], h4'
      );
      const link = card.querySelector<HTMLAnchorElement>('a[href*="/jobs/"]');
      let title = titleEl?.textContent?.trim() || link?.textContent?.trim() || '';

      if (!title || title.toLowerCase().includes('search for jobs') || title.toLowerCase().startsWith('jobs in')) {
        continue;
      }

      // Company name
      const startupContainer =
        card.closest<HTMLElement>('[data-test="StartupResult"], div[class*="styles_result__"]') || card;
      const company = this.extractCompanyName(startupContainer);

      let id = '';
      if (link?.href) {
        const match = link.href.match(/\/jobs\/(\d+)/);
        if (match) id = match[1];
      }
      if (!id && card.getAttribute('data-job-id')) {
        id = card.getAttribute('data-job-id')!;
      }
      if (!id) {
        id = `wf_${Math.abs(hash(title + '_' + company))}`;
      }

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const isEasyApply =
        !!this.findApplyButton(card) ||
        card.textContent?.toLowerCase().includes('apply') ||
        false;

      // Extract posted date if present
      const dateEl = card.querySelector(
        '[data-test="JobListingPostingDate"], time, span[class*="listingDate"], span[class*="posted"]'
      );
      let cardPostedDate = dateEl?.textContent?.trim() || '';
      if (!cardPostedDate) {
        const spans = Array.from(card.querySelectorAll('span, div'));
        for (const s of spans) {
          const st = s.textContent?.trim() || '';
          if (/(?:ago|today|just posted|\d+[wdm])/i.test(st) && st.length < 35 && !st.includes('$')) {
            cardPostedDate = st;
            break;
          }
        }
      }

      cards.push({
        index: i,
        id,
        title,
        company,
        isEasyApply,
        postedDate: cardPostedDate || undefined,
      });
    }

    return cards;
  }

  async selectSearchResultCard(index: number): Promise<{ success: boolean; job?: ScrapedJob }> {
    // Dismiss any modal/dialog that might be lingering from a previous application
    await this.closeAnyOpenModal();

    const rawCards = this.getJobCardElements();
    const card = rawCards[index];
    if (!card) return { success: false };

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(300, 600);

    // Store card reference for executeApplyStep
    this.selectedCard = card;

    // Open the job post to view its details and reveal the Apply button
    await this.openJobPost(card);
    await randomDelay(1000, 1600);

    // Extract the complete, un-cut job details from the opened drawer / modal / page
    let job = this.extractFullJobDetails(card);
    if (!job || !job.jobDescription || job.jobDescription.length < 80) {
      await randomDelay(800, 1200);
      job = this.extractFullJobDetails(card);
    }

    if (job) {
      this.selectedJob = job;
      return {
        success: true,
        job,
      };
    }

    return { success: false };
  }

  private async openJobPost(card: HTMLElement): Promise<void> {
    // 1. Look for explicit "Learn more" button on the card (as shown in Wellfound UI)
    const buttons = Array.from(card.querySelectorAll<HTMLElement>('button, a[role="button"], a'));
    const learnMoreBtn = buttons.find((b) => {
      if (b.offsetWidth === 0 && b.offsetHeight === 0 && b.getClientRects().length === 0) return false;
      const text = b.textContent?.trim().toLowerCase() || '';
      return text.includes('learn more') || text.includes('view job') || text.includes('view details');
    });

    if (learnMoreBtn) {
      await simulateClick(learnMoreBtn);
      await randomDelay(1200, 2000);
      return;
    }

    // 2. Look for job title link or title element
    const titleEl = card.querySelector<HTMLElement>(
      '[data-test="JobTitle"], a[href*="/jobs/"], .styles_title__2_jV3, span[class*="title"], h3, h4'
    );
    if (titleEl) {
      await simulateClick(titleEl);
      await randomDelay(1200, 2000);
      return;
    }

    // 3. Fallback: click the card container itself
    await simulateClick(card);
    await randomDelay(1200, 2000);
  }

  async clickNextPage(): Promise<boolean> {
    this.selectedCard = null;
    this.selectedJob = null;

    // 1. Look for explicit next / load more buttons
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[data-test="load-more"], button[data-test="NextPage"], button[aria-label*="Next" i], button, a[role="button"]'
      )
    );
    for (const b of buttons) {
      if (b.offsetWidth === 0 && b.offsetHeight === 0 && b.getClientRects().length === 0) continue;
      const t = b.textContent?.trim().toLowerCase() || '';
      const test = b.getAttribute('data-test')?.toLowerCase() || '';
      if (
        test.includes('load-more') ||
        test.includes('load_more') ||
        test.includes('nextpage') ||
        t.includes('load more') ||
        t.includes('show more') ||
        t.includes('view more') ||
        t.includes('see more jobs') ||
        t === 'more jobs' ||
        t === 'next' ||
        t === 'next page'
      ) {
        b.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await randomDelay(400, 800);
        await simulateClick(b);
        await randomDelay(2500, 3500);
        return true;
      }
    }

    // 2. Infinite scroll fallback on Wellfound
    const initialCards = this.getJobCardElements();
    const initialCount = initialCards.length;

    if (initialCount > 0) {
      const lastCard = initialCards[initialCount - 1];
      // Scroll bottom-most card into view so sentinel / intersection observers fire
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
      await randomDelay(300, 600);

      // Find any scrollable parent container of the job cards list
      let scrollEl: HTMLElement | null = lastCard.parentElement;
      while (scrollEl && scrollEl !== document.body && scrollEl !== document.documentElement) {
        const style = window.getComputedStyle(scrollEl);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          scrollEl.scrollHeight > scrollEl.clientHeight
        ) {
          break;
        }
        scrollEl = scrollEl.parentElement;
      }

      if (scrollEl && scrollEl !== document.body && scrollEl !== document.documentElement) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    }

    // Also scroll the window to the bottom
    window.scrollBy({ top: 1500, behavior: 'smooth' });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Wait and check if new cards mount
    for (let i = 0; i < 7; i++) {
      await randomDelay(400, 600);
      if (this.getJobCardElements().length > initialCount) {
        return true;
      }
    }

    // Additional nudge if cards haven't mounted yet
    window.scrollBy({ top: 800, behavior: 'smooth' });
    await randomDelay(1200, 2000);
    return this.getJobCardElements().length > initialCount;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
