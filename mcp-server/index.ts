#!/usr/bin/env node
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRIDGE_PORT = Number(process.env.MCP_BRIDGE_PORT) || 8765;

// State of the connected Chrome extension
interface ConnectedExtensionState {
  ws: WebSocket | null;
  lastSeen: number;
  clientInfo?: any;
  latestState?: any;
  latestJob?: any;
}

const extensionState: ConnectedExtensionState = {
  ws: null,
  lastSeen: 0,
};

// RPC Promise tracker for messages sent to the extension
const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }
>();

function callExtension<T = any>(action: string, payload?: any, timeoutMs = 25000): Promise<T> {
  if (!extensionState.ws || extensionState.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(
      new Error(
        'AutoApply AI Chrome Extension is not currently connected to the MCP bridge. Ensure Google Chrome is running with the extension loaded.'
      )
    );
  }

  const id = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Extension request "${action}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timer });

    extensionState.ws?.send(
      JSON.stringify({
        id,
        action,
        payload,
      })
    );
  });
}

// 1. Setup Local WebSocket Bridge Server
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        server: 'AutoApply AI MCP Bridge',
        version: '1.0.0',
        port: BRIDGE_PORT,
        extensionConnected: !!(extensionState.ws && extensionState.ws.readyState === WebSocket.OPEN),
        lastSeen: extensionState.lastSeen ? new Date(extensionState.lastSeen).toISOString() : null,
      })
    );
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  extensionState.ws = ws;
  extensionState.lastSeen = Date.now();
  console.error(`[MCP Bridge] Chrome Extension connected on port ${BRIDGE_PORT}`);

  ws.on('message', (raw) => {
    extensionState.lastSeen = Date.now();
    try {
      const msg = JSON.parse(raw.toString());

      // Response to an RPC call initiated by the MCP Server
      if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve, reject, timer } = pendingRequests.get(msg.id)!;
        clearTimeout(timer);
        pendingRequests.delete(msg.id);

        if (msg.success) {
          resolve(msg.data);
        } else {
          reject(new Error(msg.error || 'Extension RPC returned an error.'));
        }
        return;
      }

      // Extension broadcast events
      if (msg.type === 'EXTENSION_HELLO') {
        extensionState.clientInfo = msg.payload;
      } else if (msg.type === 'STATE_CHANGED') {
        extensionState.latestState = msg.payload;
      } else if (msg.type === 'JOB_DETECTED') {
        extensionState.latestJob = msg.payload;
      }
    } catch (err) {
      console.error('[MCP Bridge] Error processing extension message:', err);
    }
  });

  ws.on('close', () => {
    console.error('[MCP Bridge] Chrome Extension disconnected.');
    if (extensionState.ws === ws) {
      extensionState.ws = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[MCP Bridge] WebSocket error:', err.message);
  });
});

httpServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.error(`[MCP Bridge] Listening on http://127.0.0.1:${BRIDGE_PORT}`);
});

// 2. Setup MCP Server
const server = new McpServer({
  name: 'autoapply-ai',
  version: '1.0.0',
});

// Tool: autoapply_status
server.tool(
  'autoapply_status',
  'Get real-time operational status of the AutoApply AI Chrome extension, active tab, and application rate limits.',
  {},
  async () => {
    const isConnected = !!(extensionState.ws && extensionState.ws.readyState === WebSocket.OPEN);
    if (!isConnected) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connected: false,
                message:
                  'AutoApply AI Chrome Extension is offline. Please launch Google Chrome and open the AutoApply AI Side Panel.',
                port: BRIDGE_PORT,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      const liveState = await callExtension('GET_STATE');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                connected: true,
                state: liveState,
                clientInfo: extensionState.clientInfo,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              connected: true,
              error: err.message,
            }),
          },
        ],
      };
    }
  }
);

// Tool: autoapply_get_current_job
server.tool(
  'autoapply_get_current_job',
  'Scrapes and returns the job posting currently open in the active browser tab (LinkedIn, Wellfound, Naukri, or Indeed).',
  {},
  async () => {
    try {
      const job = await callExtension('GET_CURRENT_JOB');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(job || { message: 'No job detected in active tab.' }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to scrape job: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_apply_current_job
server.tool(
  'autoapply_apply_current_job',
  'Applies to the job in the current browser tab using either semi-auto (pauses at review) or full-auto (direct submit). You can supply custom pitch notes, cover letters, and Q&A answers drafted by your LLM context.',
  {
    mode: z
      .enum(['semi-auto', 'full-auto'])
      .optional()
      .describe("Execution mode: 'semi-auto' (default, pauses before submit for review) or 'full-auto'"),
    customPitch: z
      .string()
      .optional()
      .describe('Tailored 150-word pitch note generated by the coding agent for Wellfound/LinkedIn notes'),
    customCoverLetter: z
      .string()
      .optional()
      .describe('Bespoke cover letter generated by the coding agent tailored to the job description'),
    customAnswers: z
      .array(
        z.object({
          questionPattern: z.string().describe('Keywords or regex pattern matching the question label'),
          answer: z.string().describe('Answer to inject into matching form fields'),
        })
      )
      .optional()
      .describe('Array of tailored answers for open-ended or specific questions on the application form'),
  },
  async ({ mode, customPitch, customCoverLetter, customAnswers }) => {
    try {
      const result = await callExtension('APPLY_CURRENT_JOB', {
        mode: mode || 'semi-auto',
        customPitch,
        customCoverLetter,
        customAnswers,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to apply to current job: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_save_job_artifacts
server.tool(
  'autoapply_save_job_artifacts',
  'Stores AI-generated artifacts (cold outreach email, personalized cover letter, pitch note, LinkedIn message, relevance notes) directly into the applied job database record.',
  {
    platform: z.enum(['linkedin', 'indeed', 'wellfound', 'naukri']).describe('Platform of the job'),
    externalJobId: z.string().describe('External job ID'),
    coldEmail: z.string().optional().describe('Personalized cold outreach email drafted for the hiring manager/recruiter'),
    coverLetter: z.string().optional().describe('Bespoke tailored cover letter for this role'),
    pitchNote: z.string().optional().describe('Concise pitch note answering why candidate is interested'),
    linkedinConnectionNote: z.string().optional().describe('Personalized under-300-char LinkedIn connection request note'),
    notes: z.string().optional().describe('Candidate fit evaluation, relevance score (e.g. 95%), or review notes'),
    status: z.enum(['APPLIED', 'SKIPPED', 'FAILED', 'PENDING_APPROVAL']).optional().describe('Update application status if needed'),
  },
  async ({ platform, externalJobId, coldEmail, coverLetter, pitchNote, linkedinConnectionNote, notes, status }) => {
    try {
      const artifacts: any = {};
      if (coldEmail) artifacts.coldEmail = coldEmail;
      if (coverLetter) artifacts.coverLetter = coverLetter;
      if (pitchNote) artifacts.pitchNote = pitchNote;
      if (linkedinConnectionNote) artifacts.linkedinConnectionNote = linkedinConnectionNote;

      const result = await callExtension('SAVE_JOB_ARTIFACTS', {
        platform,
        externalJobId,
        artifacts,
        notes,
        status,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Artifacts updated in application database.',
                result,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to save job artifacts: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_parse_resume
server.tool(
  'autoapply_parse_resume',
  'Parses candidate resume text, automatically extracts all key fields (full name, email, phone, location, LinkedIn, GitHub, portfolio, years of experience, target roles, skills, structured markdown), and optionally updates the candidate profile.',
  {
    resumeText: z.string().describe('Raw plain text or markdown of the candidate resume to parse'),
    autoSave: z.boolean().default(true).describe('Whether to automatically update the candidate profile in extension storage'),
  },
  async ({ resumeText, autoSave }) => {
    try {
      const result = await callExtension('PARSE_RESUME_TEXT', { resumeText, autoSave });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Resume parsed and profile updated successfully.',
                result,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to parse resume: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_approve_pending
server.tool(
  'autoapply_approve_pending',
  'Approves and submits an application that is currently paused in the "WAITING_APPROVAL" review step.',
  {},
  async () => {
    try {
      const result = await callExtension('SUBMIT_PENDING_APPROVAL');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to approve application: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_get_user_profile
server.tool(
  'autoapply_get_user_profile',
  "Retrieves the candidate's active profile, contact details, work authorization, salary expectations, target roles whitelist, and company blacklist.",
  {},
  async () => {
    try {
      const profile = await callExtension('GET_PROFILE');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(profile, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to retrieve profile: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_update_user_profile
server.tool(
  'autoapply_update_user_profile',
  'Updates specific fields of the user application profile (e.g. targetRoles, blacklistedCompanies, resumeMarkdown, noticePeriodDays).',
  {
    fullName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    yearsOfExperience: z.number().optional(),
    expectedSalaryNumeric: z.number().optional(),
    noticePeriodDays: z.number().optional(),
    resumeMarkdown: z.string().optional(),
    targetRoles: z.array(z.string()).optional().describe('List of target job titles to whitelist'),
    blacklistedCompanies: z.array(z.string()).optional().describe('List of companies to automatically skip'),
  },
  async (updates) => {
    try {
      const payload: any = { ...updates };
      if (updates.targetRoles || updates.blacklistedCompanies) {
        payload.jobPreferences = {};
        if (updates.targetRoles) payload.jobPreferences.targetRoles = updates.targetRoles;
        if (updates.blacklistedCompanies) payload.jobPreferences.blacklistedCompanies = updates.blacklistedCompanies;
      }
      const updated = await callExtension('UPDATE_PROFILE', payload);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, updatedProfile: updated }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to update profile: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_list_applied_jobs
server.tool(
  'autoapply_list_applied_jobs',
  'Retrieves the database records of applied jobs, including platform, dates, status, generated cover letters, and recruiter contacts.',
  {
    limit: z.number().optional().default(50).describe('Maximum number of records to return'),
  },
  async ({ limit }) => {
    try {
      const records = await callExtension('GET_APPLIED_JOBS', { limit });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(records, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to retrieve applied jobs: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_queue_control
server.tool(
  'autoapply_queue_control',
  'Controls the autonomous queue orchestrator across open job search results.',
  {
    action: z.enum(['start', 'pause', 'resume', 'stop']).describe('Queue control action to execute'),
    mode: z.enum(['semi-auto', 'full-auto']).optional().describe('Execution mode for the queue'),
  },
  async ({ action, mode }) => {
    try {
      const actionMap: Record<string, string> = {
        start: 'START_QUEUE',
        pause: 'PAUSE_QUEUE',
        resume: 'RESUME_QUEUE',
        stop: 'STOP_QUEUE',
      };
      const result = await callExtension(actionMap[action], { mode: mode || 'semi-auto' });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, action, result }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Queue control action failed: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_search_and_apply
server.tool(
  'autoapply_search_and_apply',
  'Automatically navigates to a job board (LinkedIn, Indeed, etc.), executes a search with Easy-Apply / Remote filters, inspects job cards card-by-card, checks candidate fit & blacklist, and applies autonomously in semi-auto or full-auto mode.',
  {
    query: z
      .string()
      .describe('Job title or search keywords (e.g. "Full Stack Developer", "React Engineer", "Python Backend")'),
    location: z
      .string()
      .optional()
      .describe('Location filter (e.g. "Remote", "San Francisco, CA", "United States")'),
    platform: z
      .enum(['linkedin', 'indeed', 'wellfound', 'naukri'])
      .optional()
      .default('linkedin')
      .describe('Target job search platform (default: linkedin)'),
    mode: z
      .enum(['semi-auto', 'full-auto'])
      .optional()
      .describe("Execution mode: 'semi-auto' (pauses before submit for review) or 'full-auto' (direct submit)"),
    maxJobs: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of jobs to apply to in this session (default 10)'),
    remoteOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to apply remote-only filter (default false)'),
  },
  async ({ query, location, platform, mode, maxJobs, remoteOnly }) => {
    try {
      const result = await callExtension('SEARCH_AND_APPLY', {
        query,
        location,
        platform,
        mode,
        maxJobs,
        remoteOnly,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Autonomous search & apply started for "${query}" on ${platform}.`,
                details: result,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to initiate search and apply: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_browser_navigate
server.tool(
  'autoapply_browser_navigate',
  'Navigates the browser to any target URL in the active tab or opens a new tab.',
  {
    url: z.string().describe('The URL to navigate to (e.g. "https://mail.google.com", "https://linkedin.com", "https://jobs.lever.co/...")'),
    newTab: z.boolean().optional().default(false).describe('Whether to open the URL in a new tab (default false)'),
  },
  async ({ url, newTab }) => {
    try {
      const result = await callExtension('BROWSER_NAVIGATE', { url, newTab });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Navigation failed: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_gmail_send
server.tool(
  'autoapply_gmail_send',
  "Composes and sends an email directly via the user's authenticated Gmail session in the browser.",
  {
    to: z.string().describe('Recipient email address (e.g. "recruiter@company.com")'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content (text/markdown formatted)'),
    action: z.enum(['draft', 'send']).optional().default('draft').describe('Action to take: "draft" (creates and saves draft for review) or "send" (immediately dispatches email)'),
  },
  async ({ to, subject, body, action }) => {
    try {
      const result = await callExtension('GMAIL_SEND', { to, subject, body, action });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Gmail outreach failed: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_linkedin_outreach
server.tool(
  'autoapply_linkedin_outreach',
  'Navigates to a recruiter/founder LinkedIn profile and dispatches a personalized connection request with a grounded note or direct message.',
  {
    note: z.string().describe('Connection request note (strictly <= 300 characters) or direct message content'),
    profileUrl: z.string().optional().describe('Target LinkedIn profile URL (e.g. "https://www.linkedin.com/in/recruiter-name/")'),
    action: z.enum(['connect', 'message']).optional().default('connect').describe('Outreach action: "connect" (send invite with note) or "message" (direct chat message)'),
  },
  async ({ note, profileUrl, action }) => {
    try {
      const result = await callExtension('LINKEDIN_OUTREACH', { note, profileUrl, action });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `LinkedIn outreach failed: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_universal_apply
server.tool(
  'autoapply_universal_apply',
  'Autonomously parses and applies to jobs on ANY external ATS or career portal (Greenhouse, Lever, Ashby, Workday, or custom company careers page).',
  {
    mode: z.enum(['semi-auto', 'full-auto']).optional().default('full-auto').describe('Application mode: "semi-auto" (stops before submit) or "full-auto" (submits directly)'),
    customPitch: z.string().optional().describe('Optional custom pitch note or cover letter text'),
  },
  async ({ mode, customPitch }) => {
    try {
      const result = await callExtension('UNIVERSAL_APPLY', { mode, customPitch });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Universal ATS application failed: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_scrape_page
server.tool(
  'autoapply_scrape_page',
  'Scrapes the active browser tab or specified tab, extracting page title, URL, clean text content, forms, and any detected job information.',
  {
    tabId: z.number().optional().describe('Optional tab ID to scrape (defaults to active tab)'),
  },
  async ({ tabId }) => {
    try {
      const result = await callExtension('SCRAPE_PAGE', { tabId });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Page scrape failed: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_set_mode
server.tool(
  'autoapply_set_mode',
  'Configures the agent automation pacing, daily caps, and aggressiveness level (conservative, standard, or aggressive).',
  {
    mode: z.enum(['conservative', 'standard', 'aggressive']).describe('Automation velocity mode: "conservative" (safe jitter & 15 daily cap), "standard" (balanced), "aggressive" (rapid pacing & high daily volume)'),
    dailyCap: z.number().optional().describe('Optional daily application cap to configure (e.g. 50, 100, 200)'),
  },
  async ({ mode, dailyCap }) => {
    try {
      const result = await callExtension('SET_AUTOMATION_MODE', { mode, dailyCap });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to configure automation mode: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_reload_extension
server.tool(
  'autoapply_reload_extension',
  'Reloads the unpacked Chrome Extension runtime in Google Chrome to load new code changes without browser restart.',
  {},
  async () => {
    try {
      const result = await callExtension('RELOAD_EXTENSION', {}, 10000);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to reload extension: ${err.message}` }],
      };
    }
  }
);

// Tool: autoapply_eval_in_tab
server.tool(
  'autoapply_eval_in_tab',
  'Evaluates JavaScript in the active browser tab via chrome.scripting.executeScript in frame 0, bypassing any iframe issues.',
  {
    code: z.string().describe('JavaScript code expression to evaluate in the main frame'),
    tabId: z.number().optional().describe('Optional tab ID (defaults to active tab)'),
  },
  async ({ code, tabId }) => {
    try {
      const result = await callExtension('EVAL_IN_TAB', { code, tabId }, 15000);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to evaluate in tab: ${err.message}` }],
      };
    }
  }
);

// Connect stdio transport for the coding agent
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[AutoApply AI MCP Server] Connected to coding agent via stdio.');
}

main().catch((err) => {
  console.error('[AutoApply AI MCP Server] Fatal error:', err);
  process.exit(1);
});
