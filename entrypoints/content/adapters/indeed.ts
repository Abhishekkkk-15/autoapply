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
  setNativeSelectValue,
  randomDelay,
  waitForSelector,
} from '@/src/lib/dom-utils';
import { extractContactsFromJob } from '@/src/lib/extractor';
import { generateFormAnswer } from '@/src/lib/ai';

export class IndeedAdapter extends JobPlatformAdapter {
  readonly platform: Platform = 'indeed';

  isMatch(): boolean {
    return window.location.hostname.includes('indeed.com');
  }

  async parseCurrentJob(): Promise<ScrapedJob | null> {
    try {
      const titleEl = document.querySelector(
        'h1.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"], h2.jobTitle'
      );
      const title = titleEl?.textContent?.trim() || 'Software Engineer';

      const compEl = document.querySelector(
        '[data-testid="inlineHeader-companyName"] a, [data-testid="inlineHeader-companyName"], [data-company-name="true"], .jobsearch-InlineCompanyRating-companyHeader'
      );
      const company = compEl?.textContent?.trim() || 'Company';

      const locEl = document.querySelector(
        '[data-testid="jobsearch-JobInfoHeader-companyLocation"], div.jobsearch-JobInfoHeader-companyLocation'
      );
      const location = locEl?.textContent?.trim() || 'Remote';

      const descEl = document.querySelector(
        '#jobDescriptionText, .jobsearch-JobComponent-description'
      );
      const jobDescription = descEl?.textContent?.trim() || '';

      const urlParams = new URLSearchParams(window.location.search);
      let externalJobId = urlParams.get('jk') || '';
      if (!externalJobId) {
        const match = window.location.href.match(/jk=([a-zA-Z0-9]+)/);
        if (match) externalJobId = match[1];
      }
      if (!externalJobId) {
        externalJobId = `indeed_${Math.abs(hash(title + company))}`;
      }

      const contacts = extractContactsFromJob(jobDescription);
      const postedDate = this.extractPostedDate();

      return {
        platform: 'indeed',
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
      console.error('[Indeed] Error parsing job:', err);
      return null;
    }
  }

  private extractPostedDate(): string {
    const selectors = [
      'span.date',
      'span[data-testid="myJobsStateDate"]',
      '.jobsearch-JobMetadataFooter span',
      '.jobsearch-HiringInsights-icon--jobAge + span',
      'span.css-ky7nrm',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of Array.from(els)) {
        const text = el.textContent?.trim() || '';
        if (
          /(?:ago|posted|active|today|just posted|days|\d+d)/i.test(text) &&
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
    const btn = this.findEasyApplyButton();
    return !!btn;
  }

  private findEasyApplyButton(): HTMLElement | null {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button#indeedApplyButton, button[id*="indeedApply"], button.ia-IndeedApplyButton, button'
      )
    );
    for (const b of buttons) {
      const text = b.textContent?.trim().toLowerCase() || '';
      if (text.includes('easily apply') || text.includes('apply now')) {
        return b;
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
    const activeProfile: UserProfile = {
      ...profile,
      customAnswers: [
        ...(profile.customAnswers || []),
        ...(customOptions?.customAnswers || []),
      ],
    };
    const job = await this.parseCurrentJob();
    if (!job) {
      return { status: 'FAILED', message: 'Could not scrape Indeed job details.' };
    }

    const pref = this.matchesPreferences(job, profile);
    if (!pref.allow) {
      return { status: 'SKIPPED', message: pref.reason || 'Skipped per user preference' };
    }

    // Check if modal or Indeed Apply container is already open
    let container = this.getApplyContainer();

    if (!container) {
      const applyBtn = this.findEasyApplyButton();
      if (!applyBtn) {
        return { status: 'NO_EASY_APPLY', message: 'No Easily Apply button available on Indeed.' };
      }

      await simulateClick(applyBtn);
      await randomDelay(1500, 2500);

      container = await waitForSelector<HTMLElement>(
        '#ia-container, div[role="dialog"], .ia-BasePage, iframe[name*="indeed"]',
        6000
      );
    }

    if (!container) {
      return { status: 'FAILED', message: 'Could not detect Indeed Apply popup or modal.' };
    }

    // Step through Indeed's multi-page apply wizard
    let step = 0;
    while (step < 8) {
      step++;
      await randomDelay(1000, 1800);

      const activeContainer = this.getApplyContainer() || document.body;

      // Fill inputs on current page
      await this.fillFields(activeContainer, profile, job.jobDescription);

      const submitBtn = this.findSubmitButton(activeContainer);
      if (submitBtn) {
        if (isSemiAuto) {
          activeContainer.style.outline = '4px solid #10b981';
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Final Review',
            message: 'Ready to submit Indeed application. Awaiting user approval.',
          };
        } else {
          await simulateClick(submitBtn);
          await randomDelay(2000, 3000);
          return {
            status: 'SUBMITTED',
            message: 'Application submitted on Indeed.',
          };
        }
      }

      const reviewBtn = this.findReviewButton(activeContainer);
      if (reviewBtn) {
        await simulateClick(reviewBtn);
        await randomDelay(1200, 2000);
        if (isSemiAuto) {
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Review Application',
            message: 'Review step reached on Indeed. Awaiting user review.',
          };
        }
        continue;
      }

      const continueBtn = this.findContinueButton(activeContainer);
      if (continueBtn) {
        await simulateClick(continueBtn);
        await randomDelay(1200, 2000);
        continue;
      }

      break;
    }

    return {
      status: 'STEP_ADVANCED',
      message: 'Advanced through Indeed application steps.',
    };
  }

  private getApplyContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      '#ia-container, div[role="dialog"], .ia-BasePage, div[class*="ia-Container"]'
    );
  }

  private findContinueButton(container: HTMLElement): HTMLElement | null {
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'));
    return (
      buttons.find((b) => {
        const txt = b.textContent?.trim().toLowerCase() || '';
        return (
          (txt.includes('continue') || txt.includes('next')) &&
          !txt.includes('submit') &&
          !txt.includes('review')
        );
      }) || null
    );
  }

  private findReviewButton(container: HTMLElement): HTMLElement | null {
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'));
    return (
      buttons.find((b) => {
        const txt = b.textContent?.trim().toLowerCase() || '';
        return txt.includes('review your application') || txt.includes('review');
      }) || null
    );
  }

  private findSubmitButton(container: HTMLElement): HTMLElement | null {
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'));
    return (
      buttons.find((b) => {
        const txt = b.textContent?.trim().toLowerCase() || '';
        return txt.includes('submit your application') || txt.includes('submit');
      }) || null
    );
  }

  private async fillFields(
    container: HTMLElement,
    profile: UserProfile,
    jobDescription: string
  ): Promise<void> {
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="number"], input[type="tel"], input[type="email"]'
      )
    );

    for (const input of inputs) {
      if (input.value && input.value.trim().length > 0) continue;

      const label = this.resolveLabel(input);
      const isNum = input.type === 'number' || label.toLowerCase().includes('years') || label.toLowerCase().includes('salary');

      const answer = await generateFormAnswer(
        label,
        isNum ? 'number' : 'text',
        [],
        profile,
        jobDescription
      );

      setNativeValue(input, answer.answer);
      await randomDelay(80, 180);
    }

    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
    for (const select of selects) {
      if (select.value && select.selectedIndex > 0) continue;

      const label = this.resolveLabel(select);
      const options = Array.from(select.options).map((o) => o.text.trim());
      const answer = await generateFormAnswer(label, 'select', options, profile, jobDescription);
      setNativeSelectValue(select, answer.answer);
      await randomDelay(80, 180);
    }
  }

  private resolveLabel(el: HTMLElement): string {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')!;
    if (el.id) {
      const l = document.querySelector(`label[for="${el.id}"]`);
      if (l?.textContent) return l.textContent.trim();
    }
    const parent = el.closest('label, div');
    return parent?.querySelector('label, span, legend')?.textContent?.trim() || 'Input';
  }

  getSearchResultCards(): SearchCardInfo[] {
    const rawCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div.job_seen_beacon, ul.jobsearch-ResultsList > li, div.cardOutline'
      )
    );

    const cards: SearchCardInfo[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawCards.length; i++) {
      const card = rawCards[i];
      const titleEl = card.querySelector('h2.jobTitle, a.jcs-JobTitle');
      const title = titleEl?.textContent?.trim() || '';
      if (!title) continue;

      const compEl = card.querySelector('[data-testid="company-name"], span.companyName');
      const company = compEl?.textContent?.trim() || '';

      const link = card.querySelector<HTMLAnchorElement>('a.jcs-JobTitle, a[data-jk]');
      const id = link?.getAttribute('data-jk') || card.getAttribute('data-jk') || `indeed_${i}_${title}`;

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const text = card.textContent?.toLowerCase() || '';
      const isEasyApply = text.includes('easily apply') || text.includes('apply now');

      // Extract card posted date
      const dateEl = card.querySelector('span.date, span[data-testid="myJobsStateDate"], [class*="date"]');
      let cardPostedDate = dateEl?.textContent?.trim() || '';
      if (!cardPostedDate) {
        const spans = Array.from(card.querySelectorAll('span'));
        for (const s of spans) {
          const st = s.textContent?.trim() || '';
          if (/(?:ago|today|just posted|\d+\+?\s*days?)/i.test(st) && st.length < 35 && !st.includes('$')) {
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
        'div.job_seen_beacon, ul.jobsearch-ResultsList > li, div.cardOutline'
      )
    );

    const card = rawCards[index];
    if (!card) return { success: false };

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(300, 600);

    const link = card.querySelector<HTMLElement>('a.jcs-JobTitle, h2.jobTitle a, a[data-jk]') || card;
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
      'a[data-testid="pagination-page-next"], nav[aria-label="pagination"] a[aria-label="Next Page"]'
    );
    if (nextBtn) {
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await randomDelay(400, 800);
      await simulateClick(nextBtn);
      await randomDelay(2500, 3500);
      return true;
    }
    return false;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
