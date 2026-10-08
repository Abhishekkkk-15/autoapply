import type { SearchAndApplyParams } from './types';

/**
 * Generates the direct search URL for target platforms with pre-configured filters
 * such as Easy Apply only (f_AL=true / iafilter=1) and Remote (f_WT=2).
 */
export function buildJobSearchUrl(params: SearchAndApplyParams, page = 1): string {
  const platform = params.platform || 'linkedin';
  const query = params.query?.trim() || '';
  const location = params.location?.trim() || '';
  const remoteOnly = !!params.remoteOnly;

  switch (platform) {
    case 'linkedin': {
      const url = new URL('https://www.linkedin.com/jobs/search/');
      url.searchParams.set('keywords', query);
      if (location) {
        url.searchParams.set('location', location);
      }
      // f_AL=true filters for Easy Apply only
      url.searchParams.set('f_AL', 'true');
      // f_TPR=r2592000 filters for jobs posted in past month (30 days)
      url.searchParams.set('f_TPR', 'r2592000');
      if (remoteOnly) {
        // f_WT=2 is LinkedIn filter for On-site/remote: Remote
        url.searchParams.set('f_WT', '2');
      }
      if (page > 1) {
        url.searchParams.set('start', String((page - 1) * 25));
      }
      return url.toString();
    }

    case 'indeed': {
      const url = new URL('https://www.indeed.com/jobs');
      url.searchParams.set('q', query);
      if (location) {
        url.searchParams.set('l', location);
      }
      // iafilter=1 filters for "Easily apply" on Indeed
      url.searchParams.set('iafilter', '1');
      // fromage=30 filters for jobs posted within the last 30 days (1 month)
      url.searchParams.set('fromage', '30');
      if (remoteOnly) {
        url.searchParams.set('sc', '0kf:attr(DS3S6);');
      }
      if (page > 1) {
        url.searchParams.set('start', String((page - 1) * 10));
      }
      return url.toString();
    }

    case 'wellfound': {
      const url = new URL('https://wellfound.com/jobs');
      if (query) {
        url.searchParams.set('role', query);
      }
      if (location) {
        url.searchParams.set('location', location);
      }
      return url.toString();
    }

    case 'naukri': {
      const qSlug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const locSlug = location ? `-in-${location.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
      const base = `https://www.naukri.com/${qSlug}-jobs${locSlug}${page > 1 ? `-${page}` : ''}`;
      return `${base}?days=30`;
    }

    default:
      return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&f_AL=true`;
  }
}
