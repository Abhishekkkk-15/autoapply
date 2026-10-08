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
import { generateFormAnswer } from '@/src/lib/ai';

export class NaukriAdapter extends JobPlatformAdapter {
  readonly platform: Platform = 'naukri';

  isMatch(): boolean {
    return window.location.hostname.includes('naukri.com');
  }

  async parseCurrentJob(): Promise<ScrapedJob | null> {
    try {
      const titleEl = document.querySelector(
        '.jd-header-title, h1.title, .styles_title__NDjH4, h1'
      );
      const title = titleEl?.textContent?.trim() || 'Software Engineer';

      const companyEl = document.querySelector(
        '.jd-header-comp-name a, .styles_job-header-comp-name__a__0wJb, a.comp-name, .company-name'
      );
      const company = companyEl?.textContent?.trim() || 'Unknown Company';

      const locationEl = document.querySelector(
        '.loc, .styles_loc__uTsmk, .location, .styles_jhc__loc___ref2'
      );
      const location = locationEl?.textContent?.trim() || 'India / Remote';

      const descEl = document.querySelector(
        '.job-desc, .styles_job-desc-container__lqV4L, .jd-description, #job-description'
      );
      const jobDescription = descEl?.textContent?.trim() || '';

      const match = window.location.pathname.match(/-(\d+)(?:\?|$)/);
      const externalJobId = match ? match[1] : `naukri_${Math.abs(hash(title + company))}`;

      // Extract recruiter details from Naukri recruiter card
      const recruiterContainer = document.querySelector(
        '.recruiter-details, .recruiter-info, .hirer-info, .rec-card'
      );
      const contacts = extractContactsFromJob(
        jobDescription,
        recruiterContainer || undefined
      );

      const postedDate = this.extractPostedDate();

      return {
        platform: 'naukri',
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
      console.error('[Naukri] Error parsing job:', err);
      return null;
    }
  }

  private extractPostedDate(): string {
    const selectors = [
      'span.day',
      'span[class*="posted-by"]',
      '.job-desc-posted span',
      'span[class*="styles_posted-by"]',
      'span[class*="styles_jhc__posted"]',
      '.job-header .date',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of Array.from(els)) {
        const text = el.textContent?.trim() || '';
        if (
          /(?:ago|posted|day|days|month|hour|today|few hours)/i.test(text) &&
          !text.includes('₹') &&
          text.length < 50
        ) {
          return text;
        }
      }
    }
    return '';
  }

  canAutoApply(): boolean {
    const btn = this.findApplyButton();
    if (!btn) return false;
    const text = btn.textContent?.trim().toLowerCase() || '';
    // If it says "company site", it requires external redirect
    return text.includes('apply') && !text.includes('company site') && !text.includes('already applied');
  }

  private findApplyButton(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      'button#apply-button, button.apply-button, button[id*="apply"], .styles_apply-button__7c1QJ'
    );
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
      return { status: 'FAILED', message: 'Failed to parse Naukri job.' };
    }

    const pref = this.matchesPreferences(job, profile);
    if (!pref.allow) {
      return { status: 'SKIPPED', message: pref.reason || 'Skipped per user preference' };
    }

    const applyBtn = this.findApplyButton();
    if (!applyBtn) {
      return { status: 'NO_EASY_APPLY', message: 'No direct 1-click apply button on Naukri.' };
    }

    const btnText = applyBtn.textContent?.trim().toLowerCase() || '';
    if (btnText.includes('company site')) {
      return {
        status: 'MANUAL_EXTERNAL',
        message: 'This job redirects to company career site.',
      };
    }

    // Click Apply
    await simulateClick(applyBtn);
    await randomDelay(1500, 2500);

    // Check if questionnaire/chatbot drawer popped up
    const questionnaire = await waitForSelector<HTMLElement>(
      '.apply-message, .chatbot-container, .apply-questions, div[class*="questionnaire"]',
      4000
    );

    if (questionnaire) {
      // Answer questionnaire fields
      const inputs = Array.from(questionnaire.querySelectorAll<HTMLInputElement>('input, textarea'));
      for (const input of inputs) {
        const label = input.getAttribute('placeholder') || input.name || 'Question';
        const isNum = input.type === 'number' || label.toLowerCase().includes('ctc') || label.toLowerCase().includes('exp');
        const answer = await generateFormAnswer(
          label,
          isNum ? 'number' : 'text',
          [],
          profile,
          job.jobDescription
        );
        setNativeValue(input, answer.answer);
        await randomDelay(100, 250);
      }

      if (isSemiAuto) {
        questionnaire.style.outline = '4px solid #10b981';
        return {
          status: 'PENDING_APPROVAL',
          needsUserApproval: true,
          stepName: 'Naukri Questionnaire Review',
          message: 'Questionnaire completed. Awaiting review to submit on Naukri.',
        };
      }

      // Submit questionnaire
      const subBtn = questionnaire.querySelector<HTMLElement>('button[type="submit"], button.send-btn, button');
      if (subBtn) {
        await simulateClick(subBtn);
        await randomDelay(1000, 2000);
      }
    }

    return {
      status: 'SUBMITTED',
      message: '1-Click Application submitted on Naukri.',
    };
  }

  /**
   * Directly submits an application modal that is currently paused at the review step on Naukri.
   */
  async submitPendingApproval(profile: UserProfile): Promise<ApplyStepResult> {
    const questionnaire = document.querySelector<HTMLElement>(
      '.apply-message, .chatbot-container, .apply-questions, div[class*="questionnaire"]'
    );
    if (questionnaire) {
      const subBtn = questionnaire.querySelector<HTMLElement>(
        'button[type="submit"], button.send-btn, button'
      );
      if (subBtn) {
        await simulateClick(subBtn);
        await randomDelay(1000, 2000);
      }
      return {
        status: 'SUBMITTED',
        message: 'Questionnaire submitted on Naukri.',
      };
    }
    return this.executeApplyStep(profile, false);
  }

  getSearchResultCards(): SearchCardInfo[] {
    const rawCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.srp-jobtuple-wrapper, article.jobTuple, div.cust-job-tuple, div[data-job-id]'
      )
    );

    const cards: SearchCardInfo[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawCards.length; i++) {
      const card = rawCards[i];
      const titleEl = card.querySelector<HTMLElement>('a.title, [class*="title"]');
      const title = titleEl?.textContent?.trim() || '';
      if (!title) continue;

      const compEl = card.querySelector<HTMLElement>('a.comp-name, [class*="comp-name"], .subTitle');
      const company = compEl?.textContent?.trim() || '';

      const link = card.querySelector<HTMLAnchorElement>('a.title, a[href*="job-listings"]');
      let id = card.getAttribute('data-job-id') || '';
      if (!id && link?.href) {
        const match = link.href.match(/(\d{6,})/);
        if (match) id = match[1];
      }
      if (!id) {
        id = `nk_${i}_${title}_${company}`;
      }

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const isEasyApply = true; // Naukri 1-click applies directly unless marked company site

      const dateEl = card.querySelector('span.job-post-day, span.posted-by, [class*="posted"]');
      let cardPostedDate = dateEl?.textContent?.trim() || '';

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
        '.srp-jobtuple-wrapper, article.jobTuple, div.cust-job-tuple, div[data-job-id]'
      )
    );

    const card = rawCards[index];
    if (!card) return { success: false };

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(300, 600);

    const link = card.querySelector<HTMLElement>('a.title, a[href*="job-listings"]') || card;
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
      'a.styles_btn-secondary__2AsLu, a.next, a[href*="jobs-"]'
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
