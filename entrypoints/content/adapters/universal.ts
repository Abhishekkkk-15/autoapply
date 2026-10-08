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
} from '@/src/lib/dom-utils';
import { extractContactsFromJob } from '@/src/lib/extractor';
import { generateFormAnswer, generatePitchAndLetter } from '@/src/lib/ai';

export class UniversalAtsAdapter extends JobPlatformAdapter {
  readonly platform: Platform = 'universal';

  isMatch(): boolean {
    const host = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();

    // 1. Known major ATS platforms
    if (
      host.includes('greenhouse.io') ||
      host.includes('lever.co') ||
      host.includes('ashbyhq.com') ||
      host.includes('myworkdayjobs.com') ||
      host.includes('workatastartup.com') ||
      host.includes('smartrecruiters.com') ||
      host.includes('bamboohr.com')
    ) {
      return true;
    }

    // 2. Generic detection: Careers page or job application form present
    const hasJobForm = !!document.querySelector(
      'form[id*="app" i], form[action*="apply" i], form[id*="job" i], form[class*="application" i], form:has(input[type="file"])'
    );
    const isCareerPath =
      pathname.includes('/jobs/') ||
      pathname.includes('/careers/') ||
      pathname.includes('/job/') ||
      pathname.includes('/career/') ||
      pathname.includes('/apply');

    return hasJobForm || isCareerPath;
  }

  async parseCurrentJob(): Promise<ScrapedJob | null> {
    try {
      // 1. Scrape Job Title
      const titleSelectors = [
        'h1.app-title',
        '.posting-headline h2',
        '.posting-headline h1',
        'h1[data-qa="job-title"]',
        'h1.job-title',
        'h1',
        'h2.job-title',
        '.job-title',
      ];
      let title = '';
      for (const sel of titleSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el?.textContent?.trim()) {
          const t = el.textContent.trim().replace(/\s+/g, ' ');
          if (t.length > 2 && t.length < 100) {
            title = t;
            break;
          }
        }
      }
      if (!title) title = 'Software Engineer';

      // 2. Scrape Company Name
      const compSelectors = [
        '.company-name',
        '.posting-company',
        '[data-qa="company-name"]',
        'span.org',
        'a[href*="/careers"]',
        'a.main-header-logo',
        'header a img',
      ];
      let company = '';
      for (const sel of compSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el?.textContent?.trim()) {
          const c = el.textContent.trim().replace(/\s+/g, ' ');
          if (c.length > 1 && c.length < 50) {
            company = c;
            break;
          }
        }
      }
      if (!company) {
        // Fallback from document title or hostname
        const hostParts = window.location.hostname.split('.');
        company = hostParts[0].charAt(0).toUpperCase() + hostParts[0].slice(1);
      }

      // 3. Scrape Location
      const locSelectors = [
        '.location',
        '.posting-categories .location',
        '[data-qa="job-location"]',
        '.job-location',
        'span[class*="location" i]',
      ];
      let location = 'Remote';
      for (const sel of locSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el?.textContent?.trim()) {
          location = el.textContent.trim().replace(/\s+/g, ' ');
          break;
        }
      }

      // 4. Scrape Full Job Description
      const descSelectors = [
        '#content',
        '#job-description',
        '.job-description',
        '.posting-description',
        '.section-wrapper',
        '[data-qa="job-description"]',
        'article',
        'main',
      ];
      let jobDescription = '';
      for (const sel of descSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el?.textContent?.trim() && el.textContent.trim().length > 100) {
          jobDescription = el.textContent.trim();
          break;
        }
      }
      if (!jobDescription) {
        jobDescription = document.body.textContent?.slice(0, 5000) || `${title} at ${company}`;
      }

      const externalJobId = `univ_${Math.abs(hashString(title + company + window.location.pathname))}`;
      const contacts = extractContactsFromJob(jobDescription);

      return {
        platform: 'universal',
        externalJobId,
        title,
        company,
        location,
        jobUrl: window.location.href,
        jobDescription,
        extractedContacts: contacts,
        canEasyApply: this.canAutoApply(),
      };
    } catch (err) {
      console.error('[UniversalAts] Error parsing job:', err);
      return null;
    }
  }

  canAutoApply(): boolean {
    return !!document.querySelector(
      'form, [data-qa="application-form"], input[name*="name" i], button[type="submit"]'
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
    const job = await this.parseCurrentJob();
    if (!job) {
      return { status: 'FAILED', message: 'Could not parse job details on current page.' };
    }

    const form =
      document.querySelector<HTMLFormElement>('form[id*="app" i]') ||
      document.querySelector<HTMLFormElement>('form[action*="apply" i]') ||
      document.querySelector<HTMLFormElement>('form') ||
      document.body;

    // 1. Fill Standard Personal Fields
    this.fillTextInput(
      form,
      ['first_name', 'firstname', 'first-name', 'fname'],
      profile.fullName.split(' ')[0] || profile.fullName
    );
    this.fillTextInput(
      form,
      ['last_name', 'lastname', 'last-name', 'lname'],
      profile.fullName.split(' ').slice(1).join(' ') || profile.fullName
    );
    this.fillTextInput(form, ['name', 'full_name', 'fullname', 'candidate_name'], profile.fullName);
    this.fillTextInput(form, ['email', 'email_address', 'candidate_email'], profile.email);
    this.fillTextInput(form, ['phone', 'mobile', 'cell', 'phone_number'], profile.phone);
    this.fillTextInput(
      form,
      ['linkedin', 'linkedin_profile', 'urls[LinkedIn]'],
      profile.linkedinUrl || ''
    );
    this.fillTextInput(
      form,
      ['github', 'github_profile', 'urls[GitHub]'],
      profile.githubUrl || ''
    );
    this.fillTextInput(
      form,
      ['portfolio', 'website', 'urls[Portfolio]', 'urls[Other]'],
      profile.portfolioUrl || ''
    );
    this.fillTextInput(
      form,
      ['location', 'city', 'current_location', 'address'],
      profile.currentLocation || ''
    );

    // 2. Cover Letter / Pitch Note field
    let { coverLetter, pitchNote } = await generatePitchAndLetter(profile, job);
    if (customOptions?.customPitch) pitchNote = customOptions.customPitch;
    if (customOptions?.customCoverLetter) coverLetter = customOptions.customCoverLetter;

    this.fillTextarea(
      form,
      ['cover_letter', 'coverletter', 'comments', 'notes', 'pitch', 'additional_information'],
      coverLetter || pitchNote
    );

    // 3. Process Custom Questions
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="number"]'));
    for (const input of inputs) {
      if (input.value) continue;
      const label = this.resolveLabel(input);
      if (!label || label.length < 3) continue;

      const ans = await generateFormAnswer(
        label,
        input.type === 'number' ? 'number' : 'text',
        [],
        profile,
        `${job.title} at ${job.company}`
      );
      if (ans?.answer) {
        setNativeValue(input, ans.answer);
        await randomDelay(80, 200);
      }
    }

    // 4. Select Dropdowns
    const selects = Array.from(form.querySelectorAll<HTMLSelectElement>('select'));
    for (const select of selects) {
      if (select.value && select.selectedIndex > 0) continue;
      const label = this.resolveLabel(select);
      const options = Array.from(select.options).map((o) => o.text.trim());
      const ans = await generateFormAnswer(label, 'select', options, profile, job.title);
      if (ans?.answer) {
        setNativeSelectValue(select, ans.answer);
        await randomDelay(80, 200);
      }
    }

    // 5. File upload check (Resume)
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput && fileInput.files?.length === 0) {
      fileInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fileInput.style.outline = '3px solid #f59e0b';
    }

    // 6. Find Submit Button
    const submitBtn =
      form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]') ||
      form.querySelector<HTMLElement>('button[id*="submit" i], button[class*="submit" i]') ||
      Array.from(form.querySelectorAll<HTMLElement>('button')).find((b) =>
        /submit|apply/i.test(b.textContent || '')
      );

    if (isSemiAuto) {
      if (submitBtn) {
        submitBtn.style.outline = '3px solid #10b981';
      }
      return {
        status: 'PENDING_APPROVAL',
        needsUserApproval: true,
        stepName: 'Review Application',
        message: 'Application form filled. Awaiting approval to submit.',
      };
    }

    // Full-auto submission
    if (submitBtn) {
      await simulateClick(submitBtn);
      await randomDelay(1500, 2500);
      return {
        status: 'SUBMITTED',
        message: `Application submitted successfully via Universal ATS on ${job.company}.`,
      };
    }

    return {
      status: 'STEP_ADVANCED',
      message: 'Form fields populated. Submit button could not be automatically clicked.',
    };
  }

  private fillTextInput(container: HTMLElement, namePatterns: string[], value: string) {
    if (!value) return;
    for (const pat of namePatterns) {
      const el = container.querySelector<HTMLInputElement>(
        `input[name*="${pat}" i], input[id*="${pat}" i], input[placeholder*="${pat}" i]`
      );
      if (el && !el.value) {
        setNativeValue(el, value);
        return;
      }
    }
  }

  private fillTextarea(container: HTMLElement, namePatterns: string[], value: string) {
    if (!value) return;
    for (const pat of namePatterns) {
      const el = container.querySelector<HTMLTextAreaElement>(
        `textarea[name*="${pat}" i], textarea[id*="${pat}" i], textarea[placeholder*="${pat}" i]`
      );
      if (el && !el.value) {
        setNativeValue(el, value);
        return;
      }
    }
  }

  private resolveLabel(el: HTMLElement): string {
    if (el.id) {
      const lbl = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
    const prev = el.previousElementSibling;
    if (prev?.textContent?.trim()) return prev.textContent.trim();
    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
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
