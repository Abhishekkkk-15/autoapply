import type {
  ScrapedJob,
  UserProfile,
  ApplyStepResult,
  Platform,
} from '@/src/lib/types';

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
    isSemiAuto: boolean
  ): Promise<ApplyStepResult>;

  /**
   * Helper to check if current job matches user blacklist/whitelist preferences
   */
  matchesPreferences(job: ScrapedJob, profile: UserProfile): { allow: boolean; reason?: string } {
    const { blacklistedCompanies, targetRoles, minSalary } = profile.jobPreferences;

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

    return { allow: true };
  }
}
