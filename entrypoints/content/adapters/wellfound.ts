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

    // Click Apply button if modal not open
    let modal = document.querySelector<HTMLElement>('div[role="dialog"], [data-test="ApplyModal"]');
    if (!modal) {
      const applyBtn = this.findApplyButton();
      if (!applyBtn) {
        return { status: 'NO_EASY_APPLY', message: 'No active Apply button found on Wellfound.' };
      }

      await simulateClick(applyBtn);
      await randomDelay(1200, 2000);
      modal = await waitForSelector<HTMLElement>('div[role="dialog"], [data-test="ApplyModal"]', 5000);
    }

    if (!modal) {
      return { status: 'FAILED', message: 'Failed to open Wellfound application modal.' };
    }

    // Use CLI Agent's custom pitch note if provided, otherwise generate
    let pitchNote = customOptions?.customPitch?.trim() || '';
    let coverLetter = customOptions?.customCoverLetter?.trim() || '';
    if (!pitchNote) {
      const generated = await generatePitchAndLetter(profile, job);
      pitchNote = generated.pitchNote;
      coverLetter = generated.coverLetter;
    }

    // Look for recruiter note textarea
    const noteTextarea = modal.querySelector<HTMLTextAreaElement>(
      'textarea[name="userNote"], textarea[placeholder*="note"], textarea[placeholder*="Why"], textarea'
    );

    if (noteTextarea && pitchNote) {
      setNativeValue(noteTextarea, pitchNote);
      await randomDelay(300, 600);
    }

    // Semi-Auto mode: halt for user confirmation
    if (isSemiAuto) {
      modal.style.outline = '4px solid #10b981';
      return {
        status: 'PENDING_APPROVAL',
        needsUserApproval: true,
        stepName: 'Wellfound Note Review',
        message: 'Tailored 150-word pitch injected into Wellfound note. Awaiting review to submit.',
        artifacts: { pitchNote, coverLetter },
      };
    }

    // Full-Auto mode: find and click Submit button
    const submitBtn = Array.from(modal.querySelectorAll<HTMLElement>('button')).find((b) => {
      const txt = b.textContent?.trim().toLowerCase() || '';
      return (
        txt.includes('send application') ||
        txt.includes('submit') ||
        txt.includes('apply now')
      );
    });

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
    const modal = document.querySelector<HTMLElement>('div[role="dialog"], [data-test="ApplyModal"]');
    if (modal) {
      const submitBtn = Array.from(modal.querySelectorAll<HTMLElement>('button, a[role="button"]')).find((b) => {
        const txt = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        return (
          txt.includes('send application') ||
          aria.includes('send application') ||
          txt.includes('submit') ||
          aria.includes('submit') ||
          txt.includes('apply now') ||
          aria.includes('apply now')
        ) && !txt.includes('back');
      });

      if (submitBtn) {
        await simulateClick(submitBtn);
        await randomDelay(1500, 2500);
        return {
          status: 'SUBMITTED',
          message: 'Application submitted on Wellfound.',
        };
      }
    }
    return this.executeApplyStep(profile, false);
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
