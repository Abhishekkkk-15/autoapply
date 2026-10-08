import { defineBackground } from 'wxt/utils/define-background';
import type {
  AutomationState,
  ExtensionMessage,
  ScrapedJob,
  ApplyStepResult,
  AppliedJobRecord,
  SearchAndApplyParams,
  UserProfile,
} from '@/src/lib/types';
import { buildJobSearchUrl } from '@/src/lib/search-urls';
import {
  db,
  addAppliedJob,
  addLog,
  getAppSettings,
  getUserProfile,
  incrementDailyApplications,
} from '@/src/lib/db';
import { generatePitchAndLetter, generateColdOutreach } from '@/src/lib/ai';
import { ExtensionMcpBridge } from '@/src/lib/mcp-bridge';

export default defineBackground(() => {
  console.log('[AutoApply AI] Background service worker initialized.');

  // Initialize MCP bridge to connect with external coding agents (Claude Code, Antigravity, etc.)
  const mcpBridge = new ExtensionMcpBridge();

  // Configure Side Panel behavior on extension icon click
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn('Side panel setPanelBehavior error:', err));
  }

  // Central state machine
  let state: AutomationState = {
    status: 'IDLE',
    mode: 'semi-auto',
    processedCount: 0,
    dailyCount: 0,
    dailyCap: 30,
    currentStepMessage: 'System idle. Navigate to a supported job board or start queue.',
  };

  let queueRunning = false;
  let queuePaused = false;
  let isSearchRunning = false;
  let isSearchPaused = false;
  let activeTabId: number | null = null;
  let pendingApprovalResolver: ((action: 'approved' | 'cancelled') => void) | null = null;
  let searchResumeResolver: (() => void) | null = null;

  async function updateState(partial: Partial<AutomationState>) {
    state = { ...state, ...partial };
    // Broadcast to MCP bridge so coding agents have real-time state
    mcpBridge.broadcastState(state);

    // Broadcast state to all extension views (Side Panel)
    chrome.runtime
      .sendMessage({
        type: 'STATE_UPDATE',
        payload: state,
      } as ExtensionMessage)
      .catch(() => {});
  }

  async function recordLog(
    level: 'info' | 'warn' | 'error' | 'success',
    message: string,
    details?: string
  ) {
    try {
      await addLog({
        timestamp: Date.now(),
        level,
        message,
        details,
      });
      chrome.runtime
        .sendMessage({
          type: 'LOG_EVENT',
          payload: { timestamp: Date.now(), level, message, details },
        } as ExtensionMessage)
        .catch(() => {});
    } catch {
      // Ignore log storage errors
    }
  }

  // Sync daily count with storage
  (async () => {
    const settings = await getAppSettings();
    state.dailyCap = settings.dailyApplicationCap;
    state.dailyCount = settings.applicationsToday;
    state.mode = settings.mode;
  })();

  // Register MCP bridge RPC handlers for coding agents (Claude Code, Antigravity, Cursor)
  mcpBridge.registerHandler('GET_STATE', async () => state);

  mcpBridge.registerHandler('GET_CURRENT_JOB', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return state.currentJob || null;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_TAB_PLATFORM' });
      if (res?.matched && res.job) {
        state.currentJob = res.job;
        return res.job;
      }
    } catch {}
    return state.currentJob || null;
  });

  mcpBridge.registerHandler('APPLY_CURRENT_JOB', async (payload: { mode?: 'semi-auto' | 'full-auto' }) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab found.');
    await executeApplyOnTab(tab.id, payload?.mode || state.mode);
    return state;
  });

  mcpBridge.registerHandler('SUBMIT_PENDING_APPROVAL', async () => {
    if (!activeTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id || null;
    }
    if (!activeTabId) throw new Error('No active browser tab.');
    const res = await chrome.tabs.sendMessage(activeTabId, { type: 'SUBMIT_PENDING_APPROVAL' });
    await handleApplyStepResult(res, state.currentJob);
    if (pendingApprovalResolver) {
      pendingApprovalResolver('approved');
      pendingApprovalResolver = null;
    }
    return res;
  });

  mcpBridge.registerHandler('START_QUEUE', async (payload: { mode?: 'semi-auto' | 'full-auto' }) => {
    await startQueue(payload?.mode || state.mode);
    return state;
  });

  mcpBridge.registerHandler('PAUSE_QUEUE', async () => {
    queuePaused = true;
    isSearchPaused = true;
    await updateState({ status: 'PAUSED', currentStepMessage: 'Queue paused via MCP coding agent.' });
    return state;
  });

  mcpBridge.registerHandler('RESUME_QUEUE', async () => {
    queuePaused = false;
    isSearchPaused = false;
    if (searchResumeResolver) {
      searchResumeResolver();
      searchResumeResolver = null;
    }
    await updateState({ status: 'RUNNING', currentStepMessage: 'Queue resumed via MCP coding agent.' });
    return state;
  });

  mcpBridge.registerHandler('STOP_QUEUE', async () => {
    queueRunning = false;
    queuePaused = false;
    isSearchRunning = false;
    isSearchPaused = false;
    if (pendingApprovalResolver) {
      pendingApprovalResolver('cancelled');
      pendingApprovalResolver = null;
    }
    if (searchResumeResolver) {
      searchResumeResolver();
      searchResumeResolver = null;
    }
    await updateState({ status: 'IDLE', currentStepMessage: 'Queue stopped via MCP coding agent.' });
    return state;
  });

  mcpBridge.registerHandler('SEARCH_AND_APPLY', async (payload: SearchAndApplyParams) => {
    startSearchAndApply(payload).catch((err) => {
      console.error('[Background] Search and apply error:', err);
    });
    return {
      started: true,
      query: payload.query,
      location: payload.location,
      platform: payload.platform || 'linkedin',
      mode: payload.mode || state.mode,
      maxJobs: payload.maxJobs || 10,
    };
  });

  mcpBridge.setOnStateChange((mcpStatus) => {
    chrome.runtime.sendMessage({
      type: 'MCP_STATUS_UPDATE',
      payload: mcpStatus,
    } as ExtensionMessage).catch(() => {});
  });

  mcpBridge.connect();

  // Message listener
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATE': {
        sendResponse(state);
        return false;
      }

      case 'CONTENT_PARSED_JOB': {
        state.currentJob = message.payload;
        updateState({ currentJob: message.payload });
        sendResponse({ ok: true });
        return false;
      }

      case 'START_QUEUE': {
        const mode = message.payload?.mode || state.mode;
        startQueue(mode);
        sendResponse({ ok: true });
        return false;
      }

      case 'START_SEARCH_AND_APPLY': {
        startSearchAndApply(message.payload).catch((err) => {
          console.error('[Background] Search and apply error:', err);
        });
        sendResponse({ ok: true });
        return false;
      }

      case 'PAUSE_QUEUE': {
        queuePaused = true;
        isSearchPaused = true;
        updateState({
          status: 'PAUSED',
          currentStepMessage: 'Queue paused by user.',
        });
        recordLog('info', 'Queue paused.');
        sendResponse({ ok: true });
        return false;
      }

      case 'RESUME_QUEUE': {
        queuePaused = false;
        isSearchPaused = false;
        if (searchResumeResolver) {
          searchResumeResolver();
          searchResumeResolver = null;
        }
        updateState({
          status: 'RUNNING',
          currentStepMessage: 'Queue resumed.',
        });
        recordLog('info', 'Queue resumed.');
        sendResponse({ ok: true });
        return false;
      }

      case 'STOP_QUEUE': {
        queueRunning = false;
        queuePaused = false;
        isSearchRunning = false;
        isSearchPaused = false;
        if (pendingApprovalResolver) {
          pendingApprovalResolver('cancelled');
          pendingApprovalResolver = null;
        }
        if (searchResumeResolver) {
          searchResumeResolver();
          searchResumeResolver = null;
        }
        updateState({
          status: 'IDLE',
          currentStepMessage: 'Queue stopped.',
        });
        recordLog('info', 'Queue stopped.');
        sendResponse({ ok: true });
        return false;
      }

      case 'EXECUTE_APPLY_ON_CURRENT_TAB': {
        (async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) {
            sendResponse({ status: 'FAILED', message: 'No active tab found.' });
            return;
          }
          const mode = message.payload?.mode || state.mode;
          await executeApplyOnTab(tab.id, mode);
          sendResponse({ ok: true });
        })();
        return true;
      }

      case 'SUBMIT_PENDING_APPROVAL': {
        (async () => {
          if (!activeTabId) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            activeTabId = tab?.id || null;
          }
          if (activeTabId) {
            try {
              const res = await chrome.tabs.sendMessage(activeTabId, {
                type: 'SUBMIT_PENDING_APPROVAL',
              } as ExtensionMessage);
              await handleApplyStepResult(res, state.currentJob);
              if (pendingApprovalResolver) {
                pendingApprovalResolver('approved');
                pendingApprovalResolver = null;
              }
              sendResponse(res);
            } catch (err: any) {
              sendResponse({ status: 'FAILED', message: err.message });
            }
          } else {
            sendResponse({ status: 'FAILED', message: 'No active tab.' });
          }
        })();
        return true;
      }

      case 'CANCEL_PENDING_APPROVAL': {
        updateState({
          status: 'IDLE',
          currentStepMessage: 'Application skipped by user.',
        });
        recordLog('warn', 'Pending application cancelled by user.');
        if (pendingApprovalResolver) {
          pendingApprovalResolver('cancelled');
          pendingApprovalResolver = null;
        }
        sendResponse({ ok: true });
        return false;
      }

      case 'STORE_APPLIED_JOB': {
        addAppliedJob(message.payload).then(() => {
          sendResponse({ ok: true });
        });
        return true;
      }

      case 'GET_MCP_STATUS': {
        sendResponse(mcpBridge.getStatus());
        return false;
      }

      case 'RECONNECT_MCP': {
        mcpBridge.connect();
        sendResponse({ ok: true });
        return false;
      }
    }
  });

  async function executeApplyOnTab(tabId: number, mode: 'semi-auto' | 'full-auto') {
    activeTabId = tabId;
    const settings = await getAppSettings();

    // Enforce daily rate limit cap
    if (settings.applicationsToday >= settings.dailyApplicationCap) {
      await updateState({
        status: 'PAUSED',
        currentStepMessage: `Daily cap of ${settings.dailyApplicationCap} applications reached! Rate limit safety active.`,
      });
      await recordLog(
        'warn',
        `Daily cap reached (${settings.applicationsToday}/${settings.dailyApplicationCap}). Halting auto-apply to protect your account.`
      );
      return;
    }

    await updateState({
      status: 'RUNNING',
      mode,
      currentStepMessage: 'Executing application step on active tab...',
    });
    await recordLog('info', `Starting application flow on tab ${tabId} (${mode} mode)`);

    try {
      // 1. Ask content script to inspect and parse current job
      const checkRes = await chrome.tabs.sendMessage(tabId, {
        type: 'CHECK_TAB_PLATFORM',
      } as ExtensionMessage);

      if (!checkRes?.matched) {
        await updateState({
          status: 'IDLE',
          currentStepMessage: 'Current page is not a supported job board.',
        });
        await recordLog('warn', 'Page is not a supported job board.');
        return;
      }

      const job: ScrapedJob = checkRes.job;
      state.currentJob = job;

      // 2. Check if already applied in local Dexie DB
      const alreadyApplied = await db.appliedJobs
        .where({ platform: job.platform, externalJobId: job.externalJobId })
        .count();

      if (alreadyApplied > 0) {
        await updateState({
          status: 'IDLE',
          currentStepMessage: `Job "${job.title}" at ${job.company} was already applied. Skipping.`,
        });
        await recordLog('info', `Skipping already applied job: ${job.title} at ${job.company}`);
        return;
      }

      // 3. Dispatch apply action to content script
      const result: ApplyStepResult = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_APPLY_ON_CURRENT_TAB',
        payload: { mode },
      } as ExtensionMessage);

      await handleApplyStepResult(result, job);
    } catch (err: any) {
      console.error('[Background] Error applying on tab:', err);
      await updateState({
        status: 'ERROR',
        lastError: err.message || 'Unknown error',
        currentStepMessage: `Error: ${err.message || 'Failed to interact with page'}`,
      });
      await recordLog('error', `Execution error on active tab: ${err.message}`);
    }
  }

  async function handleApplyStepResult(
    result: ApplyStepResult,
    job?: ScrapedJob
  ) {
    if (!result) return;

    if (result.status === 'PENDING_APPROVAL') {
      await updateState({
        status: 'WAITING_APPROVAL',
        currentStepMessage: result.message || 'Awaiting user review before submission.',
      });
      await recordLog('warn', `Pending approval: ${result.message}`);
      return;
    }

    if (result.status === 'SUBMITTED') {
      const newDaily = await incrementDailyApplications();
      state.dailyCount = newDaily;
      state.processedCount += 1;

      await updateState({
        status: 'IDLE',
        dailyCount: newDaily,
        processedCount: state.processedCount,
        currentStepMessage: `Successfully applied to ${job?.title || 'job'}! (${newDaily}/${state.dailyCap} today)`,
      });

      await recordLog(
        'success',
        `Application submitted: ${job?.title} at ${job?.company} (${job?.platform})`
      );

      // Generate and store complete artifacts (cover letter, cold email, recruiter outreach)
      if (job) {
        saveJobAndArtifacts(job, 'APPLIED');
      }
      return;
    }

    if (result.status === 'MANUAL_EXTERNAL') {
      if (job) {
        saveJobAndArtifacts(job, 'MANUAL_EXTERNAL');
      }
      await updateState({
        status: 'IDLE',
        currentStepMessage: 'Job requires external company site application.',
      });
      await recordLog('info', `External application link detected for ${job?.title}`);
      return;
    }

    if (result.status === 'SKIPPED') {
      if (job) {
        saveJobAndArtifacts(job, 'SKIPPED');
      }
      await updateState({
        status: 'IDLE',
        currentStepMessage: result.message || 'Job skipped.',
      });
      await recordLog('info', `Skipped job: ${result.message}`);
      return;
    }

    if (result.status === 'FAILED') {
      if (job) {
        saveJobAndArtifacts(job, 'FAILED');
      }
      await updateState({
        status: 'ERROR',
        lastError: result.message,
        currentStepMessage: `Failed: ${result.message}`,
      });
      await recordLog('error', `Apply failed: ${result.message}`);
    }
  }

  async function saveJobAndArtifacts(job: ScrapedJob, status: any) {
    try {
      const profile = await getUserProfile();

      // Generate Pitch, Cover Letter, and Cold Outreach in background
      const { coverLetter, pitchNote } = await generatePitchAndLetter(profile, job);
      const outreach = await generateColdOutreach(profile, job, job.extractedContacts);

      const record: Omit<AppliedJobRecord, 'id'> = {
        platform: job.platform,
        externalJobId: job.externalJobId,
        title: job.title,
        company: job.company,
        location: job.location,
        jobUrl: job.jobUrl,
        jobDescription: job.jobDescription,
        extractedContacts: job.extractedContacts,
        generatedArtifacts: {
          coverLetter,
          pitchNote,
          coldEmail: outreach.coldEmail,
          linkedinConnectionNote: outreach.linkedinConnectionNote,
        },
        status,
        appliedAt: Date.now(),
        notes: `Auto-recorded on ${new Date().toLocaleDateString()}`,
      };

      await addAppliedJob(record);
    } catch (err) {
      console.warn('Error generating artifacts for applied job:', err);
    }
  }

  async function startQueue(mode: 'semi-auto' | 'full-auto') {
    queueRunning = true;
    queuePaused = false;
    await updateState({ status: 'RUNNING', mode });
    await recordLog('info', `Queue started in ${mode} mode.`);

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      await executeApplyOnTab(activeTab.id, mode);
    }
  }

  function checkPreferences(job: ScrapedJob, profile: UserProfile): { allow: boolean; reason?: string } {
    const { blacklistedCompanies, targetRoles } = profile.jobPreferences;

    if (blacklistedCompanies?.length) {
      const compLower = job.company.toLowerCase();
      for (const blocked of blacklistedCompanies) {
        if (blocked.trim() && compLower.includes(blocked.toLowerCase().trim())) {
          return { allow: false, reason: `Company "${job.company}" is in your blacklist.` };
        }
      }
    }

    if (targetRoles?.length) {
      const titleLower = job.title.toLowerCase();
      const hasMatch = targetRoles.some((role) =>
        role.trim() && titleLower.includes(role.toLowerCase().trim())
      );
      if (!hasMatch) {
        return {
          allow: false,
          reason: `Title "${job.title}" does not match target roles filter.`,
        };
      }
    }

    return { allow: true };
  }

  function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }, timeoutMs);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function startSearchAndApply(params: SearchAndApplyParams) {
    isSearchRunning = true;
    isSearchPaused = false;
    queueRunning = true;
    queuePaused = false;

    const mode = params.mode || state.mode;
    const maxJobs = params.maxJobs || 10;
    const platform = params.platform || 'linkedin';

    await updateState({
      status: 'RUNNING',
      mode,
      processedCount: 0,
      searchParams: params,
      currentStepMessage: `Initializing autonomous search on ${platform} for "${params.query}"...`,
    });
    await recordLog(
      'info',
      `Starting autonomous search & apply on ${platform}: query="${params.query}", maxJobs=${maxJobs}, mode=${mode}`
    );

    // Check daily cap
    const settings = await getAppSettings();
    if (settings.applicationsToday >= settings.dailyApplicationCap) {
      await updateState({
        status: 'PAUSED',
        currentStepMessage: `Daily application cap reached (${settings.applicationsToday}/${settings.dailyApplicationCap}). Stopping search.`,
      });
      await recordLog('warn', 'Daily cap already reached. Search stopped.');
      isSearchRunning = false;
      return;
    }

    try {
      // 1. Build initial search URL
      const searchUrl = buildJobSearchUrl(params, 1);
      await recordLog('info', `Navigating to search URL: ${searchUrl}`);

      // 2. Navigate or create tab
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let tabId: number;
      if (currentTab?.id) {
        tabId = currentTab.id;
        await chrome.tabs.update(tabId, { url: searchUrl });
      } else {
        const createdTab = await chrome.tabs.create({ url: searchUrl, active: true });
        tabId = createdTab.id!;
      }
      activeTabId = tabId;

      await waitForTabComplete(tabId);
      await delay(3500); // Allow DOM and React/Angular apps to hydrate

      let currentPage = 1;
      let totalAppliedInRun = 0;

      while (isSearchRunning && totalAppliedInRun < maxJobs) {
        const currentSettings = await getAppSettings();
        if (currentSettings.applicationsToday >= currentSettings.dailyApplicationCap) {
          await updateState({
            status: 'PAUSED',
            currentStepMessage: `Daily application cap reached (${currentSettings.applicationsToday}/${currentSettings.dailyApplicationCap}). Halting search.`,
          });
          await recordLog('warn', `Daily cap reached during search. Halting.`);
          break;
        }

        if (isSearchPaused) {
          await updateState({ status: 'PAUSED', currentStepMessage: 'Search queue is paused.' });
          await new Promise<void>((resolve) => {
            searchResumeResolver = resolve;
          });
          if (!isSearchRunning) break;
        }

        // Fetch cards from content script
        let cardInfo: any = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            cardInfo = await chrome.tabs.sendMessage(tabId, { type: 'GET_SEARCH_RESULTS_INFO' } as ExtensionMessage);
            if (cardInfo?.count > 0) break;
          } catch {}
          await delay(2000);
        }

        const totalCards = cardInfo?.count || 0;
        if (totalCards === 0) {
          await recordLog('warn', `No job cards found on page ${currentPage}. Finishing search.`);
          break;
        }

        await recordLog('info', `Found ${totalCards} job postings on page ${currentPage}. Processing card by card...`);

        for (let cardIdx = 0; cardIdx < totalCards; cardIdx++) {
          if (!isSearchRunning || totalAppliedInRun >= maxJobs) break;
          if (isSearchPaused) {
            await updateState({ status: 'PAUSED', currentStepMessage: 'Search queue is paused.' });
            await new Promise<void>((resolve) => {
              searchResumeResolver = resolve;
            });
            if (!isSearchRunning) break;
          }

          const card = cardInfo.cards[cardIdx];
          await updateState({
            status: 'RUNNING',
            searchProgress: {
              currentCardIndex: cardIdx + 1,
              totalCardsFound: totalCards,
              currentPage,
              totalApplied: totalAppliedInRun,
              maxJobs,
            },
            currentStepMessage: `[P${currentPage} | Card ${cardIdx + 1}/${totalCards}] Opening "${card?.title || 'Job'}"...`,
          });

          // Select card
          let selectRes: any = null;
          try {
            selectRes = await chrome.tabs.sendMessage(tabId, {
              type: 'SELECT_SEARCH_RESULT_CARD',
              payload: { index: cardIdx },
            } as ExtensionMessage);
          } catch (err: any) {
            await recordLog('warn', `Failed to click card ${cardIdx + 1}: ${err.message}`);
            continue;
          }

          if (!selectRes?.success || !selectRes?.job) {
            await delay(1000);
            continue;
          }

          const job: ScrapedJob = selectRes.job;
          state.currentJob = job;
          await updateState({ currentJob: job });

          // A. Already applied check
          const alreadyCount = await db.appliedJobs
            .where({ platform: job.platform, externalJobId: job.externalJobId })
            .count();

          if (alreadyCount > 0) {
            await recordLog('info', `[Card ${cardIdx + 1}] Skipping already applied job: "${job.title}" at ${job.company}`);
            await delay(1500);
            continue;
          }

          // B. Preferences check
          const profile = await getUserProfile();
          const prefCheck = checkPreferences(job, profile);
          if (!prefCheck.allow) {
            await recordLog('info', `[Card ${cardIdx + 1}] Skipping: ${prefCheck.reason}`);
            await delay(1500);
            continue;
          }

          // C. Easy Apply check
          if (!job.canEasyApply) {
            await recordLog('info', `[Card ${cardIdx + 1}] "${job.title}" at ${job.company} requires external application link. Skipping.`);
            await delay(1500);
            continue;
          }

          // D. Apply
          await recordLog('info', `[Card ${cardIdx + 1}] Applying to "${job.title}" at ${job.company} (${mode} mode)...`);

          let applyRes: ApplyStepResult;
          try {
            applyRes = await chrome.tabs.sendMessage(tabId, {
              type: 'EXECUTE_APPLY_ON_CURRENT_TAB',
              payload: { mode },
            } as ExtensionMessage);
          } catch (err: any) {
            await recordLog('error', `Error executing application: ${err.message}`);
            continue;
          }

          if (applyRes?.status === 'PENDING_APPROVAL') {
            await updateState({
              status: 'WAITING_APPROVAL',
              currentStepMessage: `Awaiting your approval for "${job.title}" at ${job.company}. Click Approve in Side Panel or via MCP.`,
            });
            await recordLog('warn', `Waiting for approval on "${job.title}" at ${job.company}`);

            const action = await new Promise<'approved' | 'cancelled'>((resolve) => {
              pendingApprovalResolver = resolve;
            });

            if (action === 'approved') {
              totalAppliedInRun++;
              state.processedCount = totalAppliedInRun;
            } else {
              await recordLog('info', `Cancelled approval for "${job.title}"`);
            }
          } else if (applyRes?.status === 'SUBMITTED') {
            totalAppliedInRun++;
            state.processedCount = totalAppliedInRun;
            await handleApplyStepResult(applyRes, job);
          } else {
            await handleApplyStepResult(applyRes, job);
          }

          // Human jitter delay (5 to 9 seconds)
          if (isSearchRunning && totalAppliedInRun < maxJobs) {
            const jitterMs = Math.floor(Math.random() * 4000) + 5000;
            await recordLog('info', `Pausing ${(jitterMs / 1000).toFixed(1)}s for human-like jitter before next job...`);
            await delay(jitterMs);
          }
        }

        // Paginate to next page if more needed
        if (isSearchRunning && totalAppliedInRun < maxJobs) {
          await recordLog('info', `Completed page ${currentPage}. Attempting to paginate to page ${currentPage + 1}...`);
          let pageSuccess = false;
          try {
            const pageRes = await chrome.tabs.sendMessage(tabId, { type: 'PAGINATE_NEXT_PAGE' } as ExtensionMessage);
            pageSuccess = !!pageRes?.success;
          } catch {}

          if (pageSuccess) {
            currentPage++;
            await delay(4000);
          } else {
            currentPage++;
            const nextPageUrl = buildJobSearchUrl(params, currentPage);
            await recordLog('info', `Navigating to next page via URL: ${nextPageUrl}`);
            await chrome.tabs.update(tabId, { url: nextPageUrl });
            await waitForTabComplete(tabId);
            await delay(3500);
          }
        }
      }

      isSearchRunning = false;
      await updateState({
        status: 'IDLE',
        currentStepMessage: `Autonomous search complete! Submitted ${totalAppliedInRun} application(s).`,
      });
      await recordLog('success', `Autonomous search run completed. Total applied: ${totalAppliedInRun}`);
    } catch (err: any) {
      console.error('[Background] Search and apply error:', err);
      isSearchRunning = false;
      await updateState({
        status: 'ERROR',
        lastError: err.message,
        currentStepMessage: `Search error: ${err.message}`,
      });
      await recordLog('error', `Autonomous search error: ${err.message}`);
    }
  }
});
