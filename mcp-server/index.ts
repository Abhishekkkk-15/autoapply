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
  'Applies to the job in the current browser tab using either semi-auto (pauses at review) or full-auto (direct submit).',
  {
    mode: z
      .enum(['semi-auto', 'full-auto'])
      .optional()
      .describe("Execution mode: 'semi-auto' (default, pauses before submit for review) or 'full-auto'"),
  },
  async ({ mode }) => {
    try {
      const result = await callExtension('APPLY_CURRENT_JOB', { mode: mode || 'semi-auto' });
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
