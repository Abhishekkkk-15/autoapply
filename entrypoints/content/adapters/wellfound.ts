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

  isMatch(): boolean {
    const host = window.location.hostname;
    return host.includes('wellfound.com') || host.includes('angel.co');
  }

  async parseCurrentJob(): Promise<ScrapedJob | null> {
    try {
      const titleEl = document.querySelector(
        'h1, [data-test="JobTitle"], .styles_title__2_jV3, .text-xl.font-semibold'
      );
      const title = titleEl?.textContent?.trim() || 'Software Engineer';

      const companyEl = document.querySelector(
        '[data-test="StartupName"], a[href*="/company/"], .styles_companyName__3p',
        
      );
      const company = companyEl?.textContent?.trim() || 'Startup';

      const locationEl = document.querySelector(
        '[data-test="JobLocation"], .styles_location__3B, .text-sm.text-neutral-500'
      );
      const location = locationEl?.textContent?.trim() || 'Remote';

      const descEl = document.querySelector(
        '[data-test="JobDescription"], .styles_description__3w17, div[class*="description"]'
      );
      const jobDescription = descEl?.textContent?.trim() || '';

      const match = window.location.pathname.match(/\/jobs\/(\d+)/);
      const externalJobId = match ? match[1] : `wf_${Math.abs(hash(title + company))}`;

      const contacts = extractContactsFromJob(
        jobDescription,
        document.querySelector('[data-test="RecruiterCard"], div[class*="recruiter"]') || undefined
      );

      const postedDate = this.extractPostedDate();

      return {
        platform: 'wellfound',
        externalJobId,
        title,
        company,
        location,
        jobUrl: window.location.href,
        jobDescription,
        extractedContacts: contacts,
        canEasyApply: this.canAutoApply(),
        postedDate,
      };
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
    return !!this.findApplyButton();
  }

  private findApplyButton(): HTMLElement | null {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[data-test="ApplyButton"], button[data-test="QuickApplyButton"], button'
      )
    );
    for (const b of buttons) {
      const text = b.textContent?.trim().toLowerCase() || '';
      if (
        (text.includes('apply') || text.includes('quick apply')) &&
        !text.includes('applied') &&
        !text.includes('save')
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
    const job = await this.parseCurrentJob();
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
      const applyBtn = this.findApplyButton();
      if (!applyBtn) {
        return { status: 'NO_EASY_APPLY', message: 'No active Apply button found on Wellfound.' };
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

    modal = modal || (noteInput ? (noteInput.closest('div[role="dialog"], form') as HTMLElement) : null);

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
        const job: ScrapedJob = (await this.parseCurrentJob()) || {
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

  getSearchResultCards(): SearchCardInfo[] {
    const rawCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test="StartupResult"], div[class*="styles_result__"], [data-test="JobListing"], div[class*="styles_jobListing__"], div[data-test="job-listing"], div.styles_jobListing__'
      )
    );

    const cards: SearchCardInfo[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawCards.length; i++) {
      const card = rawCards[i];
      const titleEl = card.querySelector<HTMLElement>(
        '[data-test="JobTitle"], a[href*="/jobs/"], .styles_title__2_jV3, h2, h3, h4'
      );
      const title = titleEl?.textContent?.trim() || '';
      if (!title) continue;

      const compEl = card.querySelector<HTMLElement>(
        '[data-test="StartupName"], a[href*="/company/"], .styles_companyName__3p, h2, h3'
      );
      const company = compEl?.textContent?.trim() || '';

      const link = card.querySelector<HTMLAnchorElement>('a[href*="/jobs/"]');
      let id = '';
      if (link?.href) {
        const match = link.href.match(/\/jobs\/(\d+)/);
        if (match) id = match[1];
      }
      if (!id) {
        id = `wf_${i}_${title}_${company}`;
      }

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const isEasyApply =
        !!card.querySelector('button[data-test="ApplyButton"], button[data-test="QuickApplyButton"]') ||
        card.textContent?.toLowerCase().includes('apply') ||
        false;

      // Extract posted date if present
      const dateEl = card.querySelector(
        '[data-test="JobListingPostingDate"], time, span[class*="listingDate"], span[class*="posted"]'
      );
      let cardPostedDate = dateEl?.textContent?.trim() || '';
      if (!cardPostedDate) {
        const spans = Array.from(card.querySelectorAll('span'));
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
    const rawCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test="StartupResult"], div[class*="styles_result__"], [data-test="JobListing"], div[class*="styles_jobListing__"], div[data-test="job-listing"], div.styles_jobListing__'
      )
    );

    const card = rawCards[index];
    if (!card) return { success: false };

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(300, 600);

    const link = card.querySelector<HTMLElement>('a[href*="/jobs/"], [data-test="JobTitle"]') || card;
    await simulateClick(link);

    await randomDelay(1800, 2600);
    const job = await this.parseCurrentJob();
    return {
      success: !!job,
      job: job || undefined,
    };
  }

  async clickNextPage(): Promise<boolean> {
    const nextBtn = document.querySelector<HTMLElement>(
      'button[data-test="load-more"], button[data-test="NextPage"], button[aria-label="Next"]'
    );
    if (nextBtn) {
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await randomDelay(400, 800);
      await simulateClick(nextBtn);
      await randomDelay(2500, 3500);
      return true;
    }
    // Infinite scroll fallback on Wellfound: scroll down to trigger dynamic loading
    window.scrollBy({ top: 1200, behavior: 'smooth' });
    await randomDelay(2000, 3000);
    return true;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
