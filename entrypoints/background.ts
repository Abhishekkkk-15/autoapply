import { defineBackground } from 'wxt/utils/define-background';
import type {
  AutomationState,
  ExtensionMessage,
  ScrapedJob,
  ApplyStepResult,
  AppliedJobRecord,
} from '@/src/lib/types';
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
  let activeTabId: number | null = null;

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
    return res;
  });

  mcpBridge.registerHandler('START_QUEUE', async (payload: { mode?: 'semi-auto' | 'full-auto' }) => {
    await startQueue(payload?.mode || state.mode);
    return state;
  });

  mcpBridge.registerHandler('PAUSE_QUEUE', async () => {
    queuePaused = true;
    await updateState({ status: 'PAUSED', currentStepMessage: 'Queue paused via MCP coding agent.' });
    return state;
  });

  mcpBridge.registerHandler('RESUME_QUEUE', async () => {
    queuePaused = false;
    await updateState({ status: 'RUNNING', currentStepMessage: 'Queue resumed via MCP coding agent.' });
    return state;
  });

  mcpBridge.registerHandler('STOP_QUEUE', async () => {
    queueRunning = false;
    queuePaused = false;
    await updateState({ status: 'IDLE', currentStepMessage: 'Queue stopped via MCP coding agent.' });
    return state;
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

      case 'PAUSE_QUEUE': {
        queuePaused = true;
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
});
