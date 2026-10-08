import { JobPlatformAdapter } from './base';
import type {
  ScrapedJob,
  UserProfile,
  ApplyStepResult,
  Platform,
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
      const titleEl = document.querySelector(
        '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24, .top-card-layout__title'
      );
      const title = titleEl?.textContent?.trim() || 'Untitled Role';

      // 2. Company
      const companyEl = document.querySelector(
        '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .topcard__org-name-link'
      );
      const company = companyEl?.textContent?.trim() || 'Unknown Company';

      // 3. Location
      const locationEl = document.querySelector(
        '.job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet, .topcard__flavor--bullet'
      );
      const location = locationEl?.textContent?.trim().replace(/\s+/g, ' ') || 'Remote';

      // 4. Description
      const descEl = document.querySelector(
        '#job-details, .jobs-description-content__text, .jobs-description__content'
      );
      const jobDescription = descEl?.textContent?.trim() || '';

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
      };
    } catch (err) {
      console.error('[LinkedIn] Error parsing job:', err);
      return null;
    }
  }

  canAutoApply(): boolean {
    const applyButton = this.findEasyApplyButton();
    return !!applyButton;
  }

  findEasyApplyButton(): HTMLElement | null {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button.jobs-apply-button, button[aria-label*="Easy Apply"], .jobs-s-apply button, button.jobs-apply-button--top-card'
      )
    );
    for (const b of buttons) {
      const text = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      if (text.includes('easy apply') || aria.includes('easy apply')) {
        return b;
      }
    }
    return null;
  }

  async executeApplyStep(
    profile: UserProfile,
    isSemiAuto: boolean
  ): Promise<ApplyStepResult> {
    // Check if modal is already open
    let modal = this.getModalElement();

    // If modal is not open, click the Easy Apply button
    if (!modal) {
      const applyBtn = this.findEasyApplyButton();
      if (!applyBtn) {
        return {
          status: 'NO_EASY_APPLY',
          message: 'No Easy Apply button available on current job view.',
        };
      }

      await simulateClick(applyBtn);
      await randomDelay(1200, 2000);
      modal = await waitForSelector<HTMLElement>(
        '.jobs-easy-apply-modal, div[data-view-name="job-details-easy-apply-modal"], div.artdeco-modal',
        5000
      );

      if (!modal) {
        return {
          status: 'FAILED',
          message: 'Failed to open Easy Apply modal dialog.',
        };
      }
    }

    // Modal is open, let's parse job context for AI answering
    const job = await this.parseCurrentJob();
    const jobContext = `${job?.title || ''} at ${job?.company || ''}. ${job?.jobDescription?.slice(0, 1500) || ''}`;

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
      await this.fillCurrentStepFields(currentModal, profile, jobContext);
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
        if (isSemiAuto) {
          // If semi-auto, we can either click review and pause, or pause here
          await simulateClick(reviewBtn);
          await randomDelay(1000, 1800);
          const finalSubmitBtn = this.findSubmitButton(currentModal);
          if (finalSubmitBtn) {
            this.highlightModalForApproval(currentModal);
            playAlertBeep();
            return {
              status: 'PENDING_APPROVAL',
              needsUserApproval: true,
              stepName: 'Final Review',
              message: 'Reached Review step. Please review and approve application submission.',
            };
          }
        } else {
          await simulateClick(reviewBtn);
          await randomDelay(1000, 1800);
          continue;
        }
      }

      // If Next button is available, click to advance
      if (nextBtn) {
        await simulateClick(nextBtn);
        await randomDelay(1000, 1800);

        // Check if validation errors appeared
        const hasErrors = currentModal.querySelectorAll(
          '.artdeco-inline-feedback--error, .fb-form-element--error, [aria-invalid="true"]'
        );
        if (hasErrors.length > 0) {
          return {
            status: 'PENDING_APPROVAL',
            needsUserApproval: true,
            stepName: 'Form Validation Required',
            message: 'Some required fields require manual input or file selection.',
          };
        }
        continue;
      }

      // No Next, Review, or Submit button found
      break;
    }

    return {
      status: 'STEP_ADVANCED',
      message: 'Reached current step in LinkedIn application process.',
    };
  }

  private getModalElement(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      '.jobs-easy-apply-modal, div[data-view-name="job-details-easy-apply-modal"], div.artdeco-modal[role="dialog"]'
    );
  }

  private findNextButton(modal: HTMLElement): HTMLElement | null {
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button'));
    return (
      buttons.find((b) => {
        const text = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        return (
          (text.includes('next') || aria.includes('continue to next step') || aria.includes('next')) &&
          !text.includes('review') &&
          !text.includes('submit')
        );
      }) || null
    );
  }

  private findReviewButton(modal: HTMLElement): HTMLElement | null {
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button'));
    return (
      buttons.find((b) => {
        const text = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        return text.includes('review') || aria.includes('review your application');
      }) || null
    );
  }

  private findSubmitButton(modal: HTMLElement): HTMLElement | null {
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('button'));
    return (
      buttons.find((b) => {
        const text = b.textContent?.trim().toLowerCase() || '';
        const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
        return text.includes('submit application') || aria.includes('submit application');
      }) || null
    );
  }

  private async fillCurrentStepFields(
    modal: HTMLElement,
    profile: UserProfile,
    jobContext: string
  ): Promise<void> {
    // 1. Text Inputs and Number Inputs
    const textInputs = Array.from(
      modal.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="number"], input:not([type])'
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

      setNativeValue(input, answerObj.answer);
      await randomDelay(80, 200);
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
    await randomDelay(1000, 2000);
    const dismissBtns = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label="Dismiss"], button.artdeco-modal__dismiss, button[data-control-name="overlay.close_btn"]'
      )
    );
    for (const btn of dismissBtns) {
      if (btn.offsetParent !== null) {
        await simulateClick(btn);
        break;
      }
    }
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
