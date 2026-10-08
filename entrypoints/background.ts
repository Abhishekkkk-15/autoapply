import { defineBackground } from 'wxt/utils/define-background';
import type {
  AutomationState,
  ExtensionMessage,
  ScrapedJob,
  ApplyStepResult,
  AppliedJobRecord,
  SearchAndApplyParams,
  UserProfile,
  CustomQuestionAnswer,
  GeneratedArtifacts,
  Platform,
  ApplicationStatus,
} from '@/src/lib/types';
import { buildJobSearchUrl } from '@/src/lib/search-urls';
import {
  db,
  addAppliedJob,
  updateJobArtifacts,
  addLog,
  getAppSettings,
  getUserProfile,
  saveUserProfile,
  incrementDailyApplications,
} from '@/src/lib/db';
import { generatePitchAndLetter, generateColdOutreach } from '@/src/lib/ai';
import { ExtensionMcpBridge } from '@/src/lib/mcp-bridge';
import { isJobPostedTooOld } from '@/src/lib/extractor';

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

  mcpBridge.registerHandler(
    'APPLY_CURRENT_JOB',
    async (payload: {
      mode?: 'semi-auto' | 'full-auto';
      customPitch?: string;
      customCoverLetter?: string;
      customAnswers?: CustomQuestionAnswer[];
    }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active browser tab found.');
      await executeApplyOnTab(tab.id, payload?.mode || state.mode, {
        customPitch: payload?.customPitch,
        customCoverLetter: payload?.customCoverLetter,
        customAnswers: payload?.customAnswers,
      });
      return state;
    }
  );

  mcpBridge.registerHandler(
    'SAVE_JOB_ARTIFACTS',
    async (payload: {
      platform: Platform;
      externalJobId: string;
      artifacts?: Partial<GeneratedArtifacts>;
      notes?: string;
      status?: ApplicationStatus;
    }) => {
      const updated = await updateJobArtifacts(
        payload.platform,
        payload.externalJobId,
        payload.artifacts,
        payload.notes,
        payload.status
      );
      return { success: updated };
    }
  );

  mcpBridge.registerHandler('SUBMIT_PENDING_APPROVAL', async () => {
    if (!activeTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id || null;
    }
    if (!activeTabId) throw new Error('No active browser tab.');
    let job = state.currentJob;
    if (!job) {
      try {
        const check = await chrome.tabs.sendMessage(activeTabId, { type: 'CHECK_TAB_PLATFORM' });
        if (check?.job) {
          job = check.job;
          state.currentJob = job;
        }
      } catch {}
    }
    const res = await chrome.tabs.sendMessage(activeTabId, { type: 'SUBMIT_PENDING_APPROVAL' });
    await handleApplyStepResult(res, job || state.currentJob);
    if (pendingApprovalResolver) {
      pendingApprovalResolver(res?.status === 'SUBMITTED' ? 'approved' : 'cancelled');
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

  mcpBridge.registerHandler('PARSE_RESUME_TEXT', async (payload: { resumeText: string; autoSave?: boolean }) => {
    const { extractResumeDetailsHeuristic } = await import('@/src/lib/resume-parser');
    const details = extractResumeDetailsHeuristic(payload.resumeText || '');
    let profile = await getUserProfile();

    if (payload.autoSave !== false) {
      profile = {
        ...profile,
        fullName: details.fullName || profile.fullName,
        email: details.email || profile.email,
        phone: details.phone || profile.phone,
        currentLocation: details.currentLocation || profile.currentLocation,
        portfolioUrl: details.portfolioUrl || profile.portfolioUrl,
        linkedinUrl: details.linkedinUrl || profile.linkedinUrl,
        githubUrl: details.githubUrl || profile.githubUrl,
        yearsOfExperience: details.yearsOfExperience || profile.yearsOfExperience,
        resumeMarkdown: details.resumeMarkdown || profile.resumeMarkdown,
        jobPreferences: {
          ...profile.jobPreferences,
          targetRoles: details.targetRoles.length
            ? Array.from(new Set([...(profile.jobPreferences?.targetRoles || []), ...details.targetRoles]))
            : profile.jobPreferences?.targetRoles || [],
        },
      };
      await saveUserProfile(profile);
      await recordLog('info', `Candidate profile auto-filled from resume for "${profile.fullName}".`);
    }

    return { details, profile };
  });

  mcpBridge.setOnStateChange((mcpStatus) => {
    chrome.runtime.sendMessage({
      type: 'MCP_STATUS_UPDATE',
      payload: mcpStatus,
    } as ExtensionMessage).catch(() => {});
  });

  mcpBridge.connect();

  // Persistent keep-alive port from Side Panel to maintain service worker & MCP connection
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel-keepalive') {
      if (!mcpBridge.getStatus().connected) {
        mcpBridge.connect();
      }
      port.onMessage.addListener((msg) => {
        if (msg.type === 'PING') {
          try {
            port.postMessage({ type: 'PONG' });
          } catch {}
          if (!mcpBridge.getStatus().connected) {
            mcpBridge.connect();
          }
        }
      });
    }
  });

  // Reconnect MCP bridge on tab navigation or activation
  chrome.tabs.onActivated.addListener(() => {
    if (!mcpBridge.getStatus().connected) {
      mcpBridge.connect();
    }
  });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && !mcpBridge.getStatus().connected) {
      mcpBridge.connect();
    }
  });

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
          await executeApplyOnTab(tab.id, mode, {
            customPitch: message.payload?.customPitch,
            customCoverLetter: message.payload?.customCoverLetter,
            customAnswers: message.payload?.customAnswers,
          });
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
              let job = state.currentJob;
              if (!job) {
                try {
                  const check = await chrome.tabs.sendMessage(activeTabId, { type: 'CHECK_TAB_PLATFORM' });
                  if (check?.job) {
                    job = check.job;
                    state.currentJob = job;
                  }
                } catch {}
              }

              const res = await chrome.tabs.sendMessage(activeTabId, {
                type: 'SUBMIT_PENDING_APPROVAL',
              } as ExtensionMessage);

              await handleApplyStepResult(res, job || state.currentJob);
              if (pendingApprovalResolver) {
                pendingApprovalResolver(res?.status === 'SUBMITTED' ? 'approved' : 'cancelled');
                pendingApprovalResolver = null;
              }
              sendResponse(res);
            } catch (err: any) {
              await updateState({
                status: 'ERROR',
                lastError: err.message,
                currentStepMessage: `Approval error: ${err.message}`,
              });
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

      case 'SAVE_JOB_ARTIFACTS': {
        updateJobArtifacts(
          message.payload.platform,
          message.payload.externalJobId,
          message.payload.artifacts,
          message.payload.notes,
          message.payload.status
        ).then((ok) => {
          sendResponse({ ok });
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

  async function executeApplyOnTab(
    tabId: number,
    mode: 'semi-auto' | 'full-auto',
    customOptions?: {
      customPitch?: string;
      customCoverLetter?: string;
      customAnswers?: CustomQuestionAnswer[];
    }
  ) {
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

      // 2.5 Check user preferences (whitelist, blacklist, and 30-day freshness limit)
      const profile = await getUserProfile();
      const prefCheck = checkPreferences(job, profile);
      if (!prefCheck.allow) {
        await updateState({
          status: 'IDLE',
          currentStepMessage: `Skipping: ${prefCheck.reason}`,
        });
        await recordLog('info', `Skipping "${job.title}" at ${job.company}: ${prefCheck.reason}`);
        return;
      }

      // 3. Dispatch apply action to content script
      const result: ApplyStepResult = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_APPLY_ON_CURRENT_TAB',
        payload: {
          mode,
          customPitch: customOptions?.customPitch,
          customCoverLetter: customOptions?.customCoverLetter,
          customAnswers: customOptions?.customAnswers,
        },
      } as ExtensionMessage);

      await handleApplyStepResult(result, job, {
        coverLetter: customOptions?.customCoverLetter,
        pitchNote: customOptions?.customPitch,
      });
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
    job?: ScrapedJob,
    customArtifacts?: Partial<GeneratedArtifacts>
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
        saveJobAndArtifacts(job, 'APPLIED', customArtifacts);
      }
      return;
    }

    const nextStatus = isSearchRunning ? 'RUNNING' : 'IDLE';

    if (result.status === 'MANUAL_EXTERNAL') {
      if (job) {
        saveJobAndArtifacts(job, 'MANUAL_EXTERNAL', customArtifacts);
      }
      await updateState({
        status: nextStatus,
        currentStepMessage: 'Job requires external company site application.',
      });
      await recordLog('info', `External application link detected for ${job?.title}`);
      return;
    }

    if (result.status === 'SKIPPED') {
      if (job) {
        saveJobAndArtifacts(job, 'SKIPPED', customArtifacts);
      }
      await updateState({
        status: nextStatus,
        currentStepMessage: result.message || 'Job skipped.',
      });
      await recordLog('info', `Skipped job: ${result.message}`);
      return;
    }

    if (result.status === 'FAILED') {
      if (job) {
        saveJobAndArtifacts(job, 'FAILED', customArtifacts);
      }
      await updateState({
        status: isSearchRunning ? 'RUNNING' : 'ERROR',
        lastError: result.message,
        currentStepMessage: `Failed: ${result.message}`,
      });
      await recordLog('error', `Apply failed: ${result.message}`);
      return;
    }

    if (result.status === 'STEP_ADVANCED') {
      await updateState({
        status: nextStatus,
        currentStepMessage: result.message || 'Advanced through application step.',
      });
      await recordLog('info', `Apply step result: ${result.message}`);
      return;
    }

    // Default fallback for any other unexpected status
    await updateState({
      status: nextStatus,
      currentStepMessage: result.message || `Application process finished with status: ${result.status}`,
    });
  }

  async function saveJobAndArtifacts(
    job: ScrapedJob,
    status: any,
    customArtifacts?: Partial<GeneratedArtifacts>
  ) {
    try {
      const profile = await getUserProfile();

      // Prioritize CLI Agent's generated artifacts if provided
      let coverLetter = customArtifacts?.coverLetter;
      let pitchNote = customArtifacts?.pitchNote;
      let coldEmail = customArtifacts?.coldEmail;
      let linkedinConnectionNote = customArtifacts?.linkedinConnectionNote;

      if (!coverLetter || !pitchNote) {
        const generated = await generatePitchAndLetter(profile, job);
        coverLetter = coverLetter || generated.coverLetter;
        pitchNote = pitchNote || generated.pitchNote;
      }

      if (!coldEmail) {
        const outreach = await generateColdOutreach(profile, job, job.extractedContacts);
        coldEmail = coldEmail || outreach.coldEmail;
        linkedinConnectionNote = linkedinConnectionNote || outreach.linkedinConnectionNote;
      }

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
          coldEmail,
          linkedinConnectionNote,
        },
        status,
        appliedAt: Date.now(),
        notes: `Recorded on ${new Date().toLocaleDateString()}`,
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
    const { blacklistedCompanies, targetRoles, maxDaysOld } = profile.jobPreferences;

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
      const hasMatch = targetRoles.some((role) => {
        const rLower = role.toLowerCase().trim();
        if (!rLower) return false;
        if (titleLower.includes(rLower)) return true;
        const words = rLower.split(/\s+/).filter(Boolean);
        if (words.length > 1 && words.every((w) => titleLower.includes(w))) {
          return true;
        }
        return false;
      });
      if (!hasMatch) {
        return {
          allow: false,
          reason: `Title "${job.title}" does not match target roles filter.`,
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
        if (platform === 'wellfound' && currentTab.url?.includes('wellfound.com/jobs')) {
          await recordLog('info', `Active tab is already on Wellfound jobs page: ${currentTab.url}. Preserving active view.`);
        } else {
          await chrome.tabs.update(tabId, { url: searchUrl });
          await waitForTabComplete(tabId);
          await delay(3500);
        }
      } else {
        const createdTab = await chrome.tabs.create({ url: searchUrl, active: true });
        tabId = createdTab.id!;
        await waitForTabComplete(tabId);
        await delay(3500);
      }
      activeTabId = tabId;

      let currentPage = 1;
      let totalAppliedInRun = 0;
      const seenCardIds = new Set<string>();
      let emptyBatchesCount = 0;

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
          await recordLog('warn', `No job cards found on page/batch ${currentPage}. Finishing search.`);
          break;
        }

        // Check for unseen cards in this batch
        const unseenCards = (cardInfo.cards || []).filter((c: any) => {
          const k = c?.id || `${c?.title}_${c?.company}`;
          return k && !seenCardIds.has(k);
        });

        if (unseenCards.length === 0) {
          emptyBatchesCount++;
          if (emptyBatchesCount >= 3) {
            await recordLog('info', `No new job postings loaded after multiple scroll attempts. Finished searching.`);
            break;
          }
          await recordLog('info', `All currently loaded cards have been processed. Triggering scroll to load more (attempt ${emptyBatchesCount}/3)...`);
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'PAGINATE_NEXT_PAGE' } as ExtensionMessage);
          } catch {}
          await delay(3500);
          currentPage++;
          continue;
        }

        emptyBatchesCount = 0;
        await recordLog('info', `Found ${totalCards} total job postings loaded (${unseenCards.length} new in batch ${currentPage}). Processing new cards...`);

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
          const cardKey = card?.id || `${card?.title}_${card?.company}`;
          if (cardKey && seenCardIds.has(cardKey)) {
            continue; // Skip already evaluated cards in previous scroll batches
          }
          if (cardKey) {
            seenCardIds.add(cardKey);
          }

          // Early freshness check if card metadata already contains posting date
          if (card?.postedDate) {
            const profile = await getUserProfile();
            const limitDays = profile.jobPreferences?.maxDaysOld ?? 30;
            const { tooOld, ageDays } = isJobPostedTooOld(card.postedDate, limitDays);
            if (tooOld) {
              await recordLog(
                'info',
                `[Card ${cardIdx + 1}] Skipping "${card.title || 'Job'}" - posted ${card.postedDate} (~${ageDays} days ago, exceeds ${limitDays}d limit).`
              );
              continue;
            }
          }

          await updateState({
            status: 'RUNNING',
            searchProgress: {
              currentCardIndex: cardIdx + 1,
              totalCardsFound: totalCards,
              currentPage,
              totalApplied: totalAppliedInRun,
              maxJobs,
            },
            currentStepMessage: `[Batch ${currentPage} | Card ${cardIdx + 1}/${totalCards}] Opening "${card?.title || 'Job'}"...`,
          });

          // Select card with retry for connection or hydration delays
          let selectRes: any = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              selectRes = await chrome.tabs.sendMessage(tabId, {
                type: 'SELECT_SEARCH_RESULT_CARD',
                payload: { index: card?.index ?? cardIdx },
              } as ExtensionMessage);
              break;
            } catch (err: any) {
              if (
                attempt === 0 &&
                (err.message?.includes('Receiving end') || err.message?.includes('Could not establish connection'))
              ) {
                await recordLog('info', `Tab reconnecting before card ${cardIdx + 1}. Waiting...`);
                await waitForTabComplete(tabId, 5000);
                await delay(1500);
              } else {
                await recordLog('warn', `Failed to click card ${cardIdx + 1}: ${err.message}`);
                break;
              }
            }
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
              if (isSearchRunning && totalAppliedInRun < maxJobs) {
                await updateState({
                  status: 'RUNNING',
                  currentStepMessage: `Approved! Submitted application for "${job.title}". Continuing search...`,
                });
              }
            } else {
              await recordLog('info', `Cancelled approval for "${job.title}"`);
              if (isSearchRunning && totalAppliedInRun < maxJobs) {
                await updateState({
                  status: 'RUNNING',
                  currentStepMessage: `Cancelled approval for "${job.title}". Continuing search...`,
                });
              }
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
          await recordLog('info', `Completed page/batch ${currentPage}. Attempting to load next batch...`);
          let pageSuccess = false;
          try {
            const pageRes = await chrome.tabs.sendMessage(tabId, { type: 'PAGINATE_NEXT_PAGE' } as ExtensionMessage);
            pageSuccess = !!pageRes?.success;
          } catch {}

          if (pageSuccess || platform === 'wellfound') {
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
