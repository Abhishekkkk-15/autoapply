import { defineContentScript } from 'wxt/utils/define-content-script';
import { LinkedInAdapter } from './adapters/linkedin';
import { WellfoundAdapter } from './adapters/wellfound';
import { NaukriAdapter } from './adapters/naukri';
import { IndeedAdapter } from './adapters/indeed';
import { UniversalAtsAdapter } from './adapters/universal';
import { JobPlatformAdapter } from './adapters/base';
import { executeGmailOutreach } from './outreach/gmail';
import { executeLinkedInOutreach } from './outreach/linkedin';
import type { ExtensionMessage, UserProfile } from '@/src/lib/types';
import { getUserProfile, getAppSettings } from '@/src/lib/storage';

export default defineContentScript({
  matches: ['*://*/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    console.log('[AutoApply AI] Content script injected on', window.location.href);

    const adapters: JobPlatformAdapter[] = [
      new LinkedInAdapter(),
      new WellfoundAdapter(),
      new NaukriAdapter(),
      new IndeedAdapter(),
      new UniversalAtsAdapter(),
    ];

    function getActiveAdapter(): JobPlatformAdapter | null {
      return adapters.find((a) => a.isMatch()) || null;
    }

    // Notify background script when a job page is loaded or changed
    let lastReportedJobId = '';
    async function checkAndReportCurrentJob() {
      const adapter = getActiveAdapter();
      if (!adapter) return;

      try {
        const job = await adapter.parseCurrentJob();
        if (job && job.externalJobId && job.externalJobId !== lastReportedJobId) {
          lastReportedJobId = job.externalJobId;
          chrome.runtime.sendMessage({
            type: 'CONTENT_PARSED_JOB',
            payload: job,
          } as ExtensionMessage).catch(() => {});
        }
      } catch (err) {
        // ignore background not ready
      }
    }

    // Initial check and periodic SPA navigation check
    setTimeout(checkAndReportCurrentJob, 1500);
    setInterval(checkAndReportCurrentJob, 4000);

    // Listen for extension commands
    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      const adapter = getActiveAdapter();

      if (message.type === 'CHECK_TAB_PLATFORM') {
        if (!adapter) {
          sendResponse({ matched: false });
          return false;
        }

        adapter.parseCurrentJob().then((job) => {
          sendResponse({
            matched: true,
            platform: adapter.platform,
            job,
            canAutoApply: adapter.canAutoApply(),
          });
        });
        return true; // Keep message channel open for async response
      }

      if (message.type === 'EXECUTE_APPLY_ON_CURRENT_TAB') {
        if (!adapter) {
          sendResponse({
            status: 'FAILED',
            message: 'No supported job platform detected on this page.',
          });
          return false;
        }

        (async () => {
          try {
            const profile = await getUserProfile();
            const settings = await getAppSettings();
            const isSemiAuto =
              message.payload?.mode === 'semi-auto' || settings.mode === 'semi-auto';

            const result = await adapter.executeApplyStep(profile, isSemiAuto, {
              customPitch: message.payload?.customPitch,
              customCoverLetter: message.payload?.customCoverLetter,
              customAnswers: message.payload?.customAnswers,
            });
            sendResponse(result);
          } catch (err: any) {
            console.error('[AutoApply AI] Application step error:', err);
            sendResponse({
              status: 'FAILED',
              message: err.message || 'Error occurred during apply step.',
              error: String(err),
            });
          }
        })();

        return true;
      }

      if (message.type === 'SUBMIT_PENDING_APPROVAL') {
        // User clicked Approve in SidePanel
        (async () => {
          try {
            const profile = await getUserProfile();
            if (adapter) {
              const result = await adapter.submitPendingApproval(profile);
              sendResponse(result);
            } else {
              sendResponse({ status: 'FAILED', message: 'No adapter active.' });
            }
          } catch (err: any) {
            sendResponse({ status: 'FAILED', message: err.message });
          }
        })();
        return true;
      }

      if (message.type === 'GET_SEARCH_RESULTS_INFO') {
        if (!adapter) {
          sendResponse({ count: 0, cards: [] });
          return false;
        }
        const cards = adapter.getSearchResultCards();
        sendResponse({ count: cards.length, cards });
        return false;
      }

      if (message.type === 'SELECT_SEARCH_RESULT_CARD') {
        if (!adapter) {
          sendResponse({ success: false });
          return false;
        }
        adapter.selectSearchResultCard(message.payload.index).then((res) => {
          sendResponse(res);
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });
        return true;
      }

      if (message.type === 'PAGINATE_NEXT_PAGE') {
        if (!adapter) {
          sendResponse({ success: false });
          return false;
        }
        adapter.clickNextPage().then((success) => {
          sendResponse({ success });
        }).catch(() => {
          sendResponse({ success: false });
        });
        return true;
      }

      if (message.type === 'GMAIL_COMPOSE_AND_SEND') {
        executeGmailOutreach(message.payload).then((res) => {
          sendResponse(res);
        }).catch((err) => {
          sendResponse({ success: false, message: err.message || String(err) });
        });
        return true;
      }

      if (message.type === 'LINKEDIN_SEND_OUTREACH') {
        executeLinkedInOutreach(message.payload).then((res) => {
          sendResponse(res);
        }).catch((err) => {
          sendResponse({ success: false, message: err.message || String(err) });
        });
        return true;
      }

      if (message.type === 'SCRAPE_CURRENT_PAGE') {
        (async () => {
          try {
            const currentJob = adapter ? await adapter.parseCurrentJob() : null;
            sendResponse({
              success: true,
              title: document.title,
              url: window.location.href,
              detectedJob: currentJob,
              textContent: document.body.innerText.slice(0, 15000),
              hasForms: document.querySelectorAll('form').length > 0,
            });
          } catch (err: any) {
            sendResponse({ success: false, error: err.message || String(err) });
          }
        })();
        return true;
      }

      return false;
    });
  },
});
