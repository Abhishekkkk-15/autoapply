import type { ExtractedContact } from './types';

// Blacklisted fake / boilerplate domains
const IGNORED_DOMAINS = new Set([
  'example.com',
  'domain.com',
  'yoursite.com',
  'test.com',
  'yourcompany.com',
  'email.com',
  'company.com',
  'website.com',
  'sample.com',
  'placeholder.com',
  'schema.org',
  'w3.org',
]);

const IGNORED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'mp4',
  'pdf',
  'js',
  'css',
]);

/**
 * Extracts valid email addresses via strict regex, discarding image extensions,
 * placeholder domains, and typical noise.
 */
export function extractEmails(text: string): string[] {
  if (!text) return [];

  // Pragmatic RFC 5322 email regex pattern
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const matches = text.match(emailRegex) || [];
  const uniqueEmails = new Set<string>();

  for (const match of matches) {
    const email = match.trim().toLowerCase();

    // Check file extensions disguised as emails (e.g. icon@2x.png)
    const ext = email.split('.').pop() || '';
    if (IGNORED_EXTENSIONS.has(ext)) {
      continue;
    }

    const domain = email.split('@')[1];
    if (!domain || IGNORED_DOMAINS.has(domain)) {
      continue;
    }

    // Skip git commits, hashes, or sentry strings
    if (email.length > 80 || email.startsWith('git@') || email.includes('noreply')) {
      continue;
    }

    uniqueEmails.add(email);
  }

  return Array.from(uniqueEmails);
}

/**
 * Extracts recruiter LinkedIn profile URLs and names from text or DOM elements.
 */
export function extractRecruiterProfiles(
  text: string,
  container?: Element
): { recruiterProfileUrl?: string; recruiterName?: string } {
  let recruiterProfileUrl: string | undefined;
  let recruiterName: string | undefined;

  // 1. Check DOM container if provided
  if (container) {
    // LinkedIn Hirer Card selectors
    const linkedinHirerSelectors = [
      '.hirer-card__hirer-information a[href*="/in/"]',
      '.jobs-poster__name a[href*="/in/"]',
      '.job-details-jobs-unified-top-card__hirer-profile-wrapper a[href*="/in/"]',
      'a.app-aware-link[href*="/in/"]',
      '.hiring-team a[href*="/in/"]',
    ];

    for (const sel of linkedinHirerSelectors) {
      const link = container.querySelector<HTMLAnchorElement>(sel);
      if (link && link.href && link.href.includes('/in/')) {
        recruiterProfileUrl = cleanLinkedInProfileUrl(link.href);
        const nameText = link.textContent?.trim();
        if (nameText && nameText.length > 2 && nameText.length < 50) {
          recruiterName = nameText;
        }
        break;
      }
    }

    // Naukri recruiter card selectors
    if (!recruiterName) {
      const naukriRecruiterEl = container.querySelector(
        '.recruiter-details .rec-name, .recruiter-info .rec-name, .hirer-info .rec-name'
      );
      if (naukriRecruiterEl?.textContent) {
        recruiterName = naukriRecruiterEl.textContent.trim();
      }
    }
  }

  // 2. Heuristic text search for LinkedIn profile links
  if (!recruiterProfileUrl && text) {
    const profileMatch = text.match(
      /https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_\-%]+)/i
    );
    if (profileMatch) {
      recruiterProfileUrl = cleanLinkedInProfileUrl(profileMatch[0]);
    }
  }

  // 3. Heuristic text search for "Posted by", "Hiring Manager", etc.
  if (!recruiterName && text) {
    const hiringPatterns = [
      /(?:Posted by|Hiring Team|Hiring Manager|Recruiter|Contact Person|Talent Partner):\s*([A-Z][a-zA-Z\s.]+)/i,
      /(?:Meet the hiring team|Job poster):\s*([A-Z][a-zA-Z\s.]+)/i,
    ];

    for (const pattern of hiringPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const potentialName = match[1].trim().split('\n')[0].trim();
        if (potentialName.length > 2 && potentialName.length < 40) {
          recruiterName = potentialName;
          break;
        }
      }
    }
  }

  return { recruiterProfileUrl, recruiterName };
}

function cleanLinkedInProfileUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Remove query params and hash
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return rawUrl.split('?')[0];
  }
}

/**
 * Universal extractor combining email and recruiter heuristic extraction.
 */
export function extractContactsFromJob(
  rawText: string,
  container?: Element
): ExtractedContact {
  const emails = extractEmails(rawText);
  const { recruiterProfileUrl, recruiterName } = extractRecruiterProfiles(
    rawText,
    container
  );

  return {
    emails,
    recruiterProfileUrl,
    recruiterName,
  };
}

/**
 * Parses human-readable posting dates (e.g., "Posted 1 month ago", "30+ days ago",
 * "2w ago", "3 days ago") and calculates approximate age in days.
 */
export function parsePostedAgeInDays(text?: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // Fresh posts: hours, minutes, today, just posted
  if (
    lower.includes('just posted') ||
    lower.includes('hour') ||
    lower.includes('minute') ||
    lower.includes('today') ||
    lower.includes('just now')
  ) {
    return 0;
  }

  if (lower.includes('yesterday')) {
    return 1;
  }

  // Years: e.g. "1 year ago", "2 years ago", "1yr ago"
  const yearMatch = lower.match(/(\d+)\s*(?:year|yr)s?\s*ago/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10) * 365;
  }

  // Months: e.g. "1 month ago", "2 months ago", "1mo ago", "3 mo ago"
  const monthMatch = lower.match(/(\d+)\s*(?:month|mo)s?\s*ago/);
  if (monthMatch) {
    return parseInt(monthMatch[1], 10) * 30;
  }

  // "a month ago", "month ago", "months ago", "1mo ago" without standalone leading digit
  if (
    lower.includes('month ago') ||
    lower.includes('a month ago') ||
    lower.includes('months ago') ||
    lower.includes('1mo ago')
  ) {
    return 30;
  }

  // Weeks: e.g. "3 weeks ago", "4 weeks ago", "3w ago", "4w ago"
  const weekMatch = lower.match(/(\d+)\s*(?:week|wk|w)s?\s*ago/);
  if (weekMatch) {
    return parseInt(weekMatch[1], 10) * 7;
  }
  if (lower.includes('a week ago') || lower.includes('week ago')) {
    return 7;
  }

  // Plus days: e.g. "30+ days ago", "30+ days", "14+ days ago"
  const plusDayMatch = lower.match(/(\d+)\+\s*(?:day|d)s?(?:\s*ago)?/);
  if (plusDayMatch) {
    return parseInt(plusDayMatch[1], 10) + 1;
  }

  // Days: e.g. "14 days ago", "5d ago", "3 days ago"
  const dayMatch = lower.match(/(\d+)\s*(?:day|d)s?\s*ago/);
  if (dayMatch) {
    return parseInt(dayMatch[1], 10);
  }

  // Explicit catch for "30+ days"
  if (lower.includes('30+ days') || lower.includes('30+ day')) {
    return 31;
  }

  return null;
}

/**
 * Checks whether a job posting exceeds the maximum allowed age (default 30 days / 1 month).
 */
export function isJobPostedTooOld(
  postedDateText?: string,
  maxDays = 30
): { tooOld: boolean; ageDays?: number } {
  if (!postedDateText) {
    return { tooOld: false };
  }
  const ageDays = parsePostedAgeInDays(postedDateText);
  if (ageDays === null) {
    return { tooOld: false };
  }
  return {
    tooOld: ageDays >= maxDays,
    ageDays,
  };
}
