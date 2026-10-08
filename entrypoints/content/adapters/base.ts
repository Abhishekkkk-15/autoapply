import type {
  ScrapedJob,
  UserProfile,
  ApplyStepResult,
  Platform,
  CustomQuestionAnswer,
} from '@/src/lib/types';
import { isJobPostedTooOld } from '@/src/lib/extractor';

export interface SearchCardInfo {
  index: number;
  id?: string;
  title?: string;
  company?: string;
  isEasyApply?: boolean;
  postedDate?: string;
}

export abstract class JobPlatformAdapter {
  abstract readonly platform: Platform;

  /**
   * Returns true if current webpage matches this platform's domain and job paths
   */
  abstract isMatch(): boolean;

  /**
   * Scrapes job title, company, location, description, and contact info
   */
  abstract parseCurrentJob(): Promise<ScrapedJob | null>;

  /**
   * Checks if an Easy Apply / 1-Click apply flow is present and available
   */
  abstract canAutoApply(): boolean;

  /**
   * Executes a single step or the entire apply modal workflow.
   * If isSemiAuto is true, pauses before the final submission.
   */
  abstract executeApplyStep(
    profile: UserProfile,
    isSemiAuto: boolean,
    customOptions?: {
      customPitch?: string;
      customCoverLetter?: string;
      customAnswers?: CustomQuestionAnswer[];
    }
  ): Promise<ApplyStepResult>;

  /**
   * Directly submits an application modal that is currently paused at the review/pending approval step.
   */
  async submitPendingApproval(profile: UserProfile): Promise<ApplyStepResult> {
    return this.executeApplyStep(profile, false);
  }

  /**
   * Returns list of visible job cards on search page
   */
  getSearchResultCards(): SearchCardInfo[] {
    return [];
  }

  /**
   * Clicks/selects a job card by its index in the results list
   */
  async selectSearchResultCard(_index: number): Promise<{ success: boolean; job?: ScrapedJob }> {
    return { success: false };
  }

  /**
   * Navigates to next page of search results
   */
  async clickNextPage(): Promise<boolean> {
    return false;
  }

  /**
   * Helper to check if current job matches user blacklist/whitelist/freshness preferences
   */
  matchesPreferences(job: ScrapedJob, profile: UserProfile): { allow: boolean; reason?: string } {
    const { blacklistedCompanies, targetRoles, maxDaysOld } = profile.jobPreferences;

    // Check blacklist
    if (blacklistedCompanies?.length) {
      const compLower = job.company.toLowerCase();
      for (const blocked of blacklistedCompanies) {
        if (compLower.includes(blocked.toLowerCase().trim())) {
          return { allow: false, reason: `Company "${job.company}" is blacklisted.` };
        }
      }
    }

    // Check target roles (if user defined any)
    if (targetRoles?.length) {
      const titleLower = job.title.toLowerCase();
      const hasMatch = targetRoles.some((role) =>
        titleLower.includes(role.toLowerCase().trim())
      );
      if (!hasMatch) {
        return {
          allow: false,
          reason: `Job title "${job.title}" does not match target roles filter.`,
        };
      }
    }

    // Check posting date freshness (default max 30 days / 1 month)
    const limitDays = maxDaysOld ?? 30;
    if (job.postedDate) {
      const { tooOld, ageDays } = isJobPostedTooOld(job.postedDate, limitDays);
      if (tooOld) {
        return {
          allow: false,
          reason: `Job was posted "${job.postedDate}" (~${ageDays} days ago), exceeding the ${limitDays}-day limit.`,
        };
      }
    }

    return { allow: true };
  }
}
