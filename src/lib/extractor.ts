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
