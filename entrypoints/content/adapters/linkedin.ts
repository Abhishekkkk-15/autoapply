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
import { generateFormAnswer, generatePitchAndLetter } from '@/src/lib/ai';

export class LinkedInAdapter extends JobPlatformAdapter {
  readonly platform: Platform = 'linkedin';

  isMatch(): boolean {
    return (
      window.location.hostname.includes('linkedin.com') &&
      window.location.pathname.includes('/jobs')
    );
  }

  async parseCurrentJob(): Promise<ScrapedJob | null> {
    try {
      // 1. Title
      let title = '';
      const titleSelectors = [
        '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title',
        'h2.job-details-jobs-unified-top-card__job-title',
        '.jobs-details__main-content h1',
        '.jobs-details__main-content h2',
        '.job-details-jobs-unified-top-card__content--two-pane h1',
        '.job-details-jobs-unified-top-card__content--two-pane h2',
        'h1.t-24',
        'h2.t-24',
        'div[data-view-name="job-details-top-card"] h1',
        'div[data-view-name="job-details-top-card"] h2',
        'h1.job-title',
        '.top-card-layout__title',
        'h1',
      ];
      for (const sel of titleSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        const t = el?.textContent?.trim();
        if (t && t.length > 2 && t.length < 120 && !t.toLowerCase().includes('search') && !t.toLowerCase().includes('status is')) {
          title = t.split('\n')[0].trim();
          break;
        }
      }
      if (!title && document.title.includes('|')) {
        const parts = document.title.split('|').map((p) => p.trim());
        if (parts[0] && parts[0].length > 2 && !parts[0].toLowerCase().includes('jobs')) {
          title = parts[0];
        }
      }
      if (!title) title = 'Untitled Role';

      // 2. Company
      let company = '';
      const companySelectors = [
        '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name',
        '.job-details-jobs-unified-top-card__primary-description-container a[href*="/company/"]',
        'div[data-view-name="job-details-top-card"] a[href*="/company/"]',
        'a[href*="/company/"]',
        '.topcard__org-name-link',
        '.jobs-unified-top-card__subtitle-primary-grouping a',
      ];
      for (const sel of companySelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        const c = el?.textContent?.trim();
        if (c && c.length > 1 && c.length < 80) {
          company = c.split('\n')[0].trim();
          break;
        }
      }
      if (!company && document.title.includes('|')) {
        const parts = document.title.split('|').map((p) => p.trim());
        if (parts[1] && parts[1].length > 1 && !parts[1].toLowerCase().includes('linkedin')) {
          company = parts[1];
        }
      }
      if (!company) company = 'Unknown Company';

      // 3. Location
      const locationEl = document.querySelector<HTMLElement>(
        '.job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet, .topcard__flavor--bullet, .jobs-unified-top-card__workplace-type'
      );
      const location = locationEl?.textContent?.trim().replace(/\s+/g, ' ') || 'Remote';

      // 4. Description
      const descEl = document.querySelector<HTMLElement>(
        '#job-details, div[data-view-name="job-details-description"], .jobs-description-content__text, .jobs-description__content, .jobs-description, .jobs-box__html-content, article'
      );
      let jobDescription = descEl?.textContent?.trim() || '';
      if (!jobDescription) {
        const detailCandidates = Array.from(document.querySelectorAll<HTMLElement>('div, section, article'))
          .filter((el) => {
            if (el.closest('[componentkey="SearchResultsMainContent"]') || el.closest('[componentkey*="job-card-component-ref"]')) return false;
            const t = el.textContent || '';
            return t.length > 300 && (t.includes('About the job') || t.includes('Requirements') || t.includes('Qualifications') || t.includes('Responsibilities') || t.includes('skills'));
          });
        if (detailCandidates.length > 0) {
          jobDescription = detailCandidates[0].innerText?.slice(0, 8000).trim() || '';
        }
      }

      // 5. External Job ID from URL or DOM
      const urlParams = new URLSearchParams(window.location.search);
      let externalJobId = urlParams.get('currentJobId') || '';
      if (!externalJobId) {
        const match = window.location.pathname.match(/\/view\/(\d+)/);
        if (match) externalJobId = match[1];
      }
      if (!externalJobId) {
        externalJobId = `li_${Math.abs(hashString(title + company))}`;
      }

      // 6. Recruiter & Contacts
      const contactInfo = extractContactsFromJob(
        jobDescription,
        document.querySelector('.jobs-unified-top-card, .job-details-jobs-unified-top-card__container') || undefined
      );

      // 7. Check if Easy Apply is present
      const canEasyApply = this.canAutoApply();

      // 8. Extract Posted Date
      const postedDate = this.extractPostedDate();

      return {
        platform: 'linkedin',
        externalJobId,
        title,
        company,
        location,
        jobUrl: window.location.href,
        jobDescription,
        extractedContacts: contactInfo,
        canEasyApply,
        postedDate,
      };
    } catch (err) {
      console.error('[LinkedIn] Error parsing job:', err);
      return null;
    }
  }

  extractPostedDate(): string {
    const selectors = [
      '.jobs-unified-top-card__posted-date',
      '.job-details-jobs-unified-top-card__primary-description-container span',
      'span.tvm__text--positive',
      '.jobs-unified-top-card__subtitle-primary-grouping span',
      '.topcard__flavor--metadata span',
      '.top-card-layout__entity-info time',
      'span.jobs-unified-top-card__bullet',
    ];
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of Array.from(elements)) {
        const text = el.textContent?.trim() || '';
        if (
          /(?:ago|posted|reposted|yesterday|today|hour|minute|day|week|month|year)/i.test(text) &&
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
    const applyButton = this.findEasyApplyButton();
    return !!applyButton;
  }

  findEasyApplyButton(): HTMLElement | null {
    // 1. Check known specific apply button selectors first
    const knownSelectors = [
      '.jobs-apply-button',
      'button.jobs-apply-button',
      'button[aria-label*="Easy Apply" i]',
      'button[aria-label*="easy apply" i]',
      '.jobs-apply-button--top-card button',
      'div[data-view-name="job-details-top-card"] button',
    ];
    for (const sel of knownSelectors) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(sel));
      for (const b of candidates) {
        if (
          b.closest('[componentkey="SearchResultsMainContent"]') ||
          b.closest('[componentkey*="job-card-component-ref"]') ||
          b.closest('.scaffold-layout__list') ||
          b.closest('.jobs-search-results-list')
        ) {
          continue;
        }
        const text = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        if (text.includes('easy apply') || aria.includes('easy apply')) {
          return b;
        }
      }
    }

    // 2. Query all clickable elements outside the left search results list
    const allButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[role="button"], div[role="button"], [role="button"]'
      )
    );

    const applyButtons = allButtons.filter((b) => {
      // Strictly exclude left search results cards and list container
      if (b.closest('[componentkey="SearchResultsMainContent"]')) return false;
      if (b.closest('[componentkey*="job-card-component-ref"]')) return false;
      if (b.closest('.scaffold-layout__list')) return false;
      if (b.closest('.jobs-search-results-list')) return false;

      const text = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      return text.includes('easy apply') || aria.includes('easy apply');
    });

    if (applyButtons.length > 0) {
      return applyButtons[0];
    }

    // 3. Fallback: Any element whose text is strictly 'Easy Apply' outside search list
    const textNodes = Array.from(document.querySelectorAll<HTMLElement>('span, p, div, button'))
      .filter((el) => {
        if (
          el.closest('[componentkey="SearchResultsMainContent"]') ||
          el.closest('[componentkey*="job-card-component-ref"]') ||
          el.closest('.scaffold-layout__list') ||
          el.closest('.jobs-search-results-list')
        ) {
          return false;
        }
        const text = el.textContent?.trim().toLowerCase() || '';
        return text === 'easy apply';
      });

    for (const tn of textNodes) {
      const btn =
        tn.closest<HTMLElement>('button, [role="button"]') ||
        tn.parentElement?.closest<HTMLElement>('button, [role="button"]') ||
        tn;
      return btn;
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
    const customAnswersList: CustomQuestionAnswer[] = [
      ...(profile.customAnswers || []),
      ...(customOptions?.customAnswers || []),
    ];

    if (customOptions?.customCoverLetter) {
      customAnswersList.push({
        questionPattern: 'cover letter|summary|note to hiring manager|additional info',
        answer: customOptions.customCoverLetter,
      });
    } else if (customOptions?.customPitch) {
      customAnswersList.push({
        questionPattern: 'pitch|summary|note to hiring manager|why are you interested',
        answer: customOptions.customPitch,
      });
    }

    const activeProfile: UserProfile = {
      ...profile,
      customAnswers: customAnswersList,
    };

    // Parse job to check preferences (roles, blacklist, posting freshness)
    const initialJob = await this.parseCurrentJob();
    if (initialJob) {
      const pref = this.matchesPreferences(initialJob, activeProfile);
      if (!pref.allow) {
        return {
          status: 'SKIPPED',
          message: pref.reason || 'Skipped per user preference.',
        };
      }
    }

    // Check if modal is already open
    let modal = this.getModalElement();

    // If modal is not open, check preferences and click the Easy Apply button
    if (!modal) {
      const initialJob = await this.parseCurrentJob();
      if (initialJob) {
        const pref = this.matchesPreferences(initialJob, activeProfile);
        if (!pref.allow) {
          return {
            status: 'SKIPPED',
            message: pref.reason || 'Skipped per user preference.',
          };
        }
      }

      const applyBtn = this.findEasyApplyButton();
      if (!applyBtn) {
        return {
          status: 'NO_EASY_APPLY',
          message: 'No Easy Apply button available on current job view.',
        };
      }

      applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await randomDelay(300, 600);
      await simulateClick(applyBtn);

      try {
        applyBtn.click();
      } catch {}

      // Poll for modal element to mount
      const startWait = Date.now();
      while (Date.now() - startWait < 8000) {
        modal = this.getModalElement();
        if (modal) break;
        await randomDelay(300, 500);
      }

      if (!modal) {
        return {
          status: 'FAILED',
          message: 'Failed to open Easy Apply modal dialog.',
        };
      }
    }

    // Modal is open, let's parse job context for AI answering
    const job = await this.parseCurrentJob();
    const jobContext = `${job?.title || ''} at ${job?.company || ''}. ${job?.jobDescription || ''}`;

    // Loop through modal steps (max 10 steps to prevent infinite loops)
    let stepCount = 0;
    while (stepCount < 10) {
      stepCount++;
      await randomDelay(800, 1500);

      const currentModal = this.getModalElement();
      if (!currentModal) {
        return {
          status: 'SUBMITTED',
          message: 'Application modal closed successfully (submitted).',
        };
      }

      // 1. Fill current step form fields
      await this.fillCurrentStepFields(currentModal, activeProfile, jobContext);
      await randomDelay(500, 1000);

      // 2. Identify the primary action button (Next, Review, or Submit)
      const submitBtn = this.findSubmitButton(currentModal);
      const reviewBtn = this.findReviewButton(currentModal);
      const nextBtn = this.findNextButton(currentModal);

      // Check if we are at final Submit step
      if (submitBtn) {
        if (isSemiAuto) {
          this.highlightModalForApproval(currentModal);
          playAlertBeep();
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Review and Submit',
            message: 'Application reached final Review step. Awaiting user approval to submit.',
          };
        } else {
          // Full-auto mode: click Submit
          await simulateClick(submitBtn);
          await randomDelay(1500, 2500);
          await this.closeSuccessModalIfOpen();
          return {
            status: 'SUBMITTED',
            message: 'Application submitted successfully via Easy Apply.',
          };
        }
      }

      // Check if Review button is available
      if (reviewBtn) {
        await simulateClick(reviewBtn);
        await randomDelay(1200, 2000);
        if (isSemiAuto) {
          this.highlightModalForApproval(currentModal);
          playAlertBeep();
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Final Review',
            message: 'Reached Review step. Please review and approve application submission.',
          };
        } else {
          continue;
        }
      }

      // If Next button is available, click to advance
      if (nextBtn) {
        await simulateClick(nextBtn);
        await randomDelay(1000, 1800);

        // Check if validation errors appeared
        const hasErrors = Array.from(
          currentModal.querySelectorAll<HTMLElement>(
            '.artdeco-inline-feedback--error, .fb-form-element--error, [aria-invalid="true"]'
          )
        );
        if (hasErrors.length > 0) {
          const firstErrEl = hasErrors[0];
          const label = this.resolveLabelForElement(firstErrEl) || 'Required field';
          const feedback = firstErrEl.textContent?.trim().replace(/\s+/g, ' ') || 'Validation error';
          this.highlightModalForApproval(currentModal);
          playAlertBeep();
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Form Validation Required',
            message: `Field "${label}" needs attention: ${feedback}`,
          };
        }
        continue;
      }

      // Fallback: If no button found, try scrolling to bottom of modal and re-check
      currentModal.scrollTo({ top: currentModal.scrollHeight, behavior: 'smooth' });
      await randomDelay(600, 1000);
      const retrySubmit = this.findSubmitButton(currentModal);
      if (retrySubmit) {
        if (isSemiAuto) {
          this.highlightModalForApproval(currentModal);
          playAlertBeep();
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Review and Submit',
            message: 'Application reached final Review step. Awaiting user approval to submit.',
          };
        } else {
          await simulateClick(retrySubmit);
          await randomDelay(1500, 2500);
          await this.closeSuccessModalIfOpen();
          return {
            status: 'SUBMITTED',
            message: 'Application submitted successfully via Easy Apply.',
          };
        }
      }

      // No Next, Review, or Submit button found
      break;
    }

    if (this.getModalElement()) {
      return {
        status: 'FAILED',
        message: 'Application reached an unhandled step or submit button could not be located.',
      };
    }

    return {
      status: 'SUBMITTED',
      message: 'Application modal was completed and closed.',
    };
  }

  /**
   * Directly submits an application modal that is currently paused at the review step.
   */
  async submitPendingApproval(_profile: UserProfile): Promise<ApplyStepResult> {
    const modal = this.getModalElement();
    if (!modal) {
      return {
        status: 'FAILED',
        message: 'Could not find open application modal on LinkedIn.',
      };
    }

    // 1. Check for any validation errors
    const hasErrors = Array.from(
      modal.querySelectorAll<HTMLElement>(
        '.artdeco-inline-feedback--error, .fb-form-element--error, [aria-invalid="true"]'
      )
    );
    if (hasErrors.length > 0) {
      const firstErrEl = hasErrors[0];
      const label = this.resolveLabelForElement(firstErrEl) || 'Required field';
      const feedback = firstErrEl.textContent?.trim().replace(/\s+/g, ' ') || 'Validation error';
      this.highlightModalForApproval(modal);
      playAlertBeep();
      return {
        status: 'PENDING_APPROVAL',
        needsUserApproval: true,
        stepName: 'Validation Error',
        message: `Field "${label}" needs attention: ${feedback}`,
      };
    }

    // 2. If review button is visible, click it first to advance to submit step
    const reviewBtn = this.findReviewButton(modal);
    if (reviewBtn) {
      await simulateClick(reviewBtn);
      await randomDelay(1200, 2000);
    }

    // 3. Find the submit button
    let submitBtn = this.findSubmitButton(modal);

    // If not found yet, try scrolling the modal to bottom
    if (!submitBtn) {
      modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' });
      await randomDelay(600, 1000);
      submitBtn = this.findSubmitButton(modal);
    }

    // If still not found, check footer primary button as fallback
    if (!submitBtn) {
      const footerPrimary = modal.querySelector<HTMLElement>(
        'footer button.artdeco-button--primary, .jobs-easy-apply-footer button.artdeco-button--primary, button[data-easy-apply-next-button]'
      );
      if (footerPrimary) {
        submitBtn = footerPrimary;
      }
    }

    if (!submitBtn) {
      return {
        status: 'FAILED',
        message: 'Could not locate Submit button on active LinkedIn application dialog.',
      };
    }

    // 4. Check if submit button is disabled
    if (submitBtn.hasAttribute('disabled') || submitBtn.getAttribute('aria-disabled') === 'true') {
      modal.scrollTo({ top: modal.scrollHeight, behavior: 'smooth' });
      await randomDelay(600, 1000);
      if (submitBtn.hasAttribute('disabled') || submitBtn.getAttribute('aria-disabled') === 'true') {
        this.highlightModalForApproval(modal);
        return {
          status: 'PENDING_APPROVAL',
          needsUserApproval: true,
          stepName: 'Disabled Submit Button',
          message: 'Submit button is disabled. Please verify all required fields or checkboxes in the dialog.',
        };
      }
    }

    // 5. Click the submit button
    await simulateClick(submitBtn);
    await randomDelay(2000, 3000);
    await this.closeSuccessModalIfOpen();

    return {
      status: 'SUBMITTED',
      message: 'Application submitted successfully via Easy Apply.',
    };
  }

  getModalElement(): HTMLElement | null {
    // 1. Standard known modal selectors
    const primary = document.querySelector<HTMLElement>(
      '.jobs-easy-apply-modal, div[data-view-name="job-details-easy-apply-modal"], div[data-easy-apply-modal], .artdeco-modal, div[data-test-modal], [role="dialog"], [aria-modal="true"]'
    );
    if (primary) return primary;

    // 2. Any container containing an Easy Apply action button (Next, Review, Submit) outside the search list
    const actionBtn = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => {
      if (b.closest('[componentkey="SearchResultsMainContent"]')) return false;
      const txt = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      return (
        txt === 'next' ||
        aria.includes('continue to next') ||
        txt === 'review' ||
        aria.includes('review your application') ||
        txt.includes('submit application') ||
        aria.includes('submit application')
      );
    });

    if (actionBtn) {
      // Traverse up to find dialog or modal container
      let curr: HTMLElement | null = actionBtn;
      for (let i = 0; i < 15 && curr && curr !== document.body; i++) {
        const role = curr.getAttribute('role');
        const ariaModal = curr.getAttribute('aria-modal');
        const comp = curr.getAttribute('componentkey')?.toLowerCase() || '';
        const cls = curr.className?.toLowerCase() || '';
        if (
          role === 'dialog' ||
          ariaModal === 'true' ||
          comp.includes('modal') ||
          comp.includes('dialog') ||
          cls.includes('modal') ||
          cls.includes('dialog')
        ) {
          return curr;
        }
        curr = curr.parentElement;
      }
      // If no explicit dialog attribute, find container with 'Apply to' or 'pages' or 'Contact info'
      curr = actionBtn;
      let modalCandidate: HTMLElement | null = null;
      for (let i = 0; i < 10 && curr && curr !== document.body; i++) {
        const text = curr.textContent || '';
        if (text.includes('Apply to') || text.includes('Contact info') || text.includes('pages')) {
          modalCandidate = curr;
        }
        curr = curr.parentElement;
      }
      if (modalCandidate) return modalCandidate;
    }

    // 3. Any element on page with text "Apply to" and form/inputs
    const applyToCandidate = Array.from(document.querySelectorAll<HTMLElement>('div, section')).find((el) => {
      if (el.closest('[componentkey="SearchResultsMainContent"]')) return false;
      const text = el.textContent || '';
      return (
        text.includes('Apply to') &&
        (text.includes('pages') || text.includes('Contact info')) &&
        el.querySelectorAll('input, button').length >= 3 &&
        el.children.length < 20
      );
    });
    if (applyToCandidate) return applyToCandidate;

    return null;
  }

  findNextButton(modal: HTMLElement): HTMLElement | null {
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button, a[role="button"]'));
    return (
      buttons.find((b) => {
        const text = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        return (
          (text.includes('next') || aria.includes('continue to next step') || aria.includes('next')) &&
          !text.includes('review') &&
          !aria.includes('review') &&
          !text.includes('submit') &&
          !aria.includes('submit')
        );
      }) || null
    );
  }

  findReviewButton(modal: HTMLElement): HTMLElement | null {
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button, a[role="button"]'));
    return (
      buttons.find((b) => {
        const text = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        return (
          (text.includes('review') || aria.includes('review')) &&
          !text.includes('submit') &&
          !aria.includes('submit')
        );
      }) || null
    );
  }

  findSubmitButton(modal: HTMLElement): HTMLElement | null {
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button, a[role="button"]'));

    // 1. Explicit text or aria match
    const explicit = buttons.find((b) => {
      const text = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      const isSubmit =
        text.includes('submit') ||
        aria.includes('submit') ||
        text === 'apply' ||
        aria === 'apply' ||
        text.includes('apply now') ||
        aria.includes('apply now') ||
        text.includes('send application') ||
        aria.includes('send application');

      const isBackOrCancel =
        text.includes('back') ||
        aria.includes('back') ||
        text.includes('cancel') ||
        aria.includes('cancel') ||
        text.includes('dismiss') ||
        aria.includes('dismiss');

      return isSubmit && !isBackOrCancel;
    });

    if (explicit) return explicit;

    // 2. Primary button in footer if not next/review/back
    const footerPrimary = modal.querySelector<HTMLElement>(
      'footer button.artdeco-button--primary, .jobs-easy-apply-footer button.artdeco-button--primary, button[data-easy-apply-next-button]'
    );
    if (footerPrimary) {
      const text = footerPrimary.textContent?.trim().toLowerCase() || '';
      const aria = footerPrimary.getAttribute('aria-label')?.toLowerCase() || '';
      if (
        !text.includes('next') &&
        !aria.includes('next') &&
        !text.includes('continue') &&
        !aria.includes('continue') &&
        !text.includes('review') &&
        !aria.includes('review') &&
        !text.includes('back') &&
        !aria.includes('back')
      ) {
        return footerPrimary;
      }
    }

    return null;
  }

  private async fillCurrentStepFields(
    modal: HTMLElement,
    profile: UserProfile,
    jobContext: string
  ): Promise<void> {
    // 1. Text Inputs and Number Inputs
    const textInputs = Array.from(
      modal.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="number"], input[type="tel"], input[type="email"], input:not([type])'
      )
    );

    for (const input of textInputs) {
      if (input.value && input.value.trim().length > 0) continue; // Already filled

      const label = this.resolveLabelForElement(input);
      const isNumber = input.type === 'number' || label.toLowerCase().includes('years') || label.toLowerCase().includes('salary');

      const answerObj = await generateFormAnswer(
        label,
        isNumber ? 'number' : 'text',
        [],
        profile,
        jobContext
      );

      // Check if this input is a custom Artdeco Combobox / Typeahead autocomplete
      const isCombobox =
        input.getAttribute('role') === 'combobox' ||
        input.getAttribute('aria-autocomplete') === 'list' ||
        input.closest('.artdeco-typeahead, .search-basic-typeahead') !== null;

      if (isCombobox) {
        setNativeValue(input, answerObj.answer);
        await randomDelay(350, 600);

        // Look for autocomplete suggestion dropdown listbox
        const container = input.closest('.artdeco-typeahead, .search-basic-typeahead, div') || modal;
        const suggestion = container.querySelector<HTMLElement>(
          'div[role="listbox"] div[role="option"], .basic-typeahead__triggered-content li, .artdeco-typeahead__results-list li, [role="option"]'
        );

        if (suggestion) {
          await simulateClick(suggestion);
        } else {
          // Trigger Enter keydown
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
      } else {
        setNativeValue(input, answerObj.answer);
      }

      await randomDelay(100, 250);
    }

    // 2. Select dropdowns
    const selects = Array.from(modal.querySelectorAll<HTMLSelectElement>('select'));
    for (const select of selects) {
      if (select.value && select.selectedIndex > 0) continue;

      const label = this.resolveLabelForElement(select);
      const options = Array.from(select.options).map((o) => o.text.trim());

      const answerObj = await generateFormAnswer(
        label,
        'select',
        options,
        profile,
        jobContext
      );

      setNativeSelectValue(select, answerObj.answer);
      await randomDelay(80, 200);
    }

    // 3. Radio groups (Yes/No questions or choices)
    const fieldsets = Array.from(modal.querySelectorAll<HTMLElement>('fieldset'));
    for (const fs of fieldsets) {
      const radios = Array.from(fs.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      if (radios.length === 0) continue;

      // Check if already selected
      const isAnyChecked = radios.some((r) => r.checked);
      if (isAnyChecked) continue;

      const legend = fs.querySelector('legend')?.textContent?.trim() || '';
      const options = radios.map((r) => {
        const rLabel = this.resolveLabelForElement(r);
        return rLabel || r.value;
      });

      const answerObj = await generateFormAnswer(
        legend,
        'radio',
        options,
        profile,
        jobContext
      );

      // Find matching radio
      for (const radio of radios) {
        const rLabel = this.resolveLabelForElement(radio).toLowerCase();
        if (
          rLabel.includes(answerObj.answer.toLowerCase()) ||
          radio.value.toLowerCase().includes(answerObj.answer.toLowerCase())
        ) {
          await simulateClick(radio);
          break;
        }
      }
    }

    // 4. Textareas (Why do you want to work here / Additional info)
    const textareas = Array.from(modal.querySelectorAll<HTMLTextAreaElement>('textarea'));
    for (const ta of textareas) {
      if (ta.value && ta.value.trim().length > 10) continue;

      const label = this.resolveLabelForElement(ta);
      if (label.toLowerCase().includes('cover letter') || label.toLowerCase().includes('why')) {
        const generated = await generatePitchAndLetter(profile, {
          platform: 'linkedin',
          externalJobId: '',
          title: 'Role',
          company: 'Company',
          location: '',
          jobUrl: '',
          jobDescription: jobContext,
          extractedContacts: { emails: [] },
          canEasyApply: true,
        });
        setNativeValue(ta, generated.pitchNote);
      } else {
        const answer = await generateFormAnswer(label, 'text', [], profile, jobContext);
        setNativeValue(ta, answer.answer);
      }
    }
  }

  private resolveLabelForElement(element: HTMLElement): string {
    // 1. Check aria-label
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label')!;
    }
    // 2. Check id <label for="...">
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    // 3. Check closest label
    const parentLabel = element.closest('label');
    if (parentLabel?.textContent) return parentLabel.textContent.trim();

    // 4. Check preceding sibling or parent container heading
    const container = element.closest('.fb-form-element, .jobs-easy-apply-form-section__grouping, div');
    const header = container?.querySelector('label, h3, h4, span.t-bold');
    if (header?.textContent) return header.textContent.trim();

    return 'Form Field';
  }

  private highlightModalForApproval(modal: HTMLElement): void {
    modal.style.outline = '4px solid #10b981';
    modal.style.boxShadow = '0 0 24px rgba(16, 185, 129, 0.4)';
    modal.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private async closeSuccessModalIfOpen(): Promise<void> {
    await randomDelay(1200, 2200);
    const dismissBtns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label="Dismiss"], button.artdeco-modal__dismiss, button[data-control-name="overlay.close_btn"], button.artdeco-toast-item__dismiss'
      )
    );
    for (const btn of dismissBtns) {
      if (btn.offsetParent !== null) {
        await simulateClick(btn);
        return;
      }
    }

    const modal = this.getModalElement();
    if (modal) {
      const doneBtn = Array.from(modal.querySelectorAll<HTMLElement>('button')).find((b) => {
        const txt = b.textContent?.trim().toLowerCase() || '';
        return txt === 'done' || txt === 'dismiss' || txt === 'close';
      });
      if (doneBtn) {
        await simulateClick(doneBtn);
      }
    }
  }

  getSearchResultCards(): SearchCardInfo[] {
    const cards: SearchCardInfo[] = [];
    const seenIds = new Set<string>();

    // 1. Target modern LinkedIn 2026 atomic UI cards via componentkey and lazy-column
    const modernCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[componentkey*="job-card-component-ref-"][role="button"], [componentkey*="job-card-component-ref-"]'
      )
    );

    // 2. Query legacy selectors as fallback
    const legacyCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        'li[data-occludable-job-id], div[data-view-name="job-card"], div.job-card-container, li.jobs-search-results__list-item'
      )
    );

    const candidateElements = modernCards.length > 0 ? modernCards : legacyCards;

    for (const card of candidateElements) {
      const cardText = card.textContent || '';
      if (!cardText || cardText.length < 5) continue;

      // Extract job ID
      let id = '';
      const compKey = card.getAttribute('componentkey') || '';
      const mKey = compKey.match(/\d{6,}/);
      if (mKey) id = mKey[0];

      if (!id) {
        const attrId = card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id') || '';
        const mAttr = attrId.match(/\d{6,}/);
        if (mAttr) id = mAttr[0];
      }

      if (!id) {
        const link = card.querySelector<HTMLAnchorElement>('a[href*="currentJobId="], a[href*="/jobs/view/"]');
        if (link?.href) {
          const m1 = link.href.match(/currentJobId=(\d+)/);
          if (m1) id = m1[1];
          if (!id) {
            const m2 = link.href.match(/\/jobs\/view\/(\d+)/);
            if (m2) id = m2[1];
          }
        }
      }

      // Extract title and company from text lines
      const rawLines = cardText
        .split('\n')
        .map((l) => l.trim().replace(/^selected,\s*/i, '').replace(/status is\s+/i, ''))
        .filter((l) => l && l.length > 1 && !/^(more|about|help center|feedback)$/i.test(l));

      const uniqueLines = rawLines.filter((l, idx) => idx === 0 || l !== rawLines[idx - 1]);
      const title = uniqueLines[0] || '';
      if (!title || title.length < 2) continue;

      let company = uniqueLines[1] || 'Company';
      if (/^(india|remote|united states|hybrid|posted|applied|viewed)/i.test(company) && uniqueLines[2]) {
        company = uniqueLines[2];
      }

      if (!id) {
        id = `card_${title}_${company}`;
      }

      // Deduplicate so duplicate parent/child elements never produce duplicate entries
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const isEasyApply = cardText.toLowerCase().includes('easy apply');

      // Posting date
      let cardPostedDate = '';
      for (const line of uniqueLines) {
        if (/(?:ago|today|yesterday|\d+[wdm])/i.test(line) && line.length < 35 && !line.includes('$')) {
          cardPostedDate = line;
          break;
        }
      }

      cards.push({
        index: cards.length,
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
    const cards = this.getSearchResultCards();
    const target = cards[index];
    if (!target) {
      return { success: false };
    }

    // Find the clickable card element
    let cardEl: HTMLElement | null = null;
    if (target.id && /^\d+$/.test(target.id)) {
      cardEl =
        document.querySelector<HTMLElement>(`[componentkey*="${target.id}"][role="button"]`) ||
        document.querySelector<HTMLElement>(`[componentkey*="${target.id}"]`) ||
        document.querySelector<HTMLElement>(`[data-occludable-job-id*="${target.id}"]`) ||
        document.querySelector<HTMLElement>(`a[href*="${target.id}"]`);
    }

    if (!cardEl) {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[componentkey*="job-card-component-ref-"][role="button"], [componentkey*="job-card-component-ref-"]'
        )
      );
      for (const el of candidates) {
        if (target.title && el.textContent?.toLowerCase().includes(target.title.toLowerCase())) {
          cardEl = el;
          break;
        }
      }
    }

    if (!cardEl) {
      return { success: false };
    }

    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(300, 600);

    await simulateClick(cardEl);

    // Wait for the detail view on the right pane to update
    await randomDelay(2000, 3000);

    await waitForSelector(
      '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, #job-details, div[data-view-name="job-details-top-card"], h1, h2',
      5000
    );

    let job = await this.parseCurrentJob();
    if (job) {
      if ((!job.title || job.title === 'Untitled Role') && target.title) {
        job.title = target.title;
      }
      if ((!job.company || job.company === 'Unknown Company') && target.company) {
        job.company = target.company;
      }
      if (target.id && (!job.externalJobId || job.externalJobId.startsWith('li_'))) {
        job.externalJobId = target.id;
      }
      if (target.isEasyApply && !job.canEasyApply) {
        job.canEasyApply = true;
      }
    }
    return {
      success: !!job,
      job: job || undefined,
    };
  }

  async clickNextPage(): Promise<boolean> {
    const nextBtn = document.querySelector<HTMLElement>(
      'button[aria-label="View next page"], button[aria-label="Next"], .jobs-search-pagination__button--next, .artdeco-pagination__button--next'
    );
    if (nextBtn && !nextBtn.hasAttribute('disabled') && nextBtn.getAttribute('aria-disabled') !== 'true') {
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await randomDelay(400, 800);
      await simulateClick(nextBtn);
      await randomDelay(2500, 3500);
      return true;
    }

    const activePage = document.querySelector(
      '.artdeco-pagination__indicator--number.active, .jobs-search-pagination__indicator-button--active, li.active[data-test-pagination-page-btn]'
    );
    const nextLi = activePage?.parentElement?.nextElementSibling || activePage?.nextElementSibling;
    const nextNumBtn = nextLi?.querySelector<HTMLElement>('button');
    if (nextNumBtn) {
      nextNumBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await randomDelay(400, 800);
      await simulateClick(nextNumBtn);
      await randomDelay(2500, 3500);
      return true;
    }

    return false;
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function playAlertBeep(): void {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch {
    // Audio context may require user interaction
  }
}
