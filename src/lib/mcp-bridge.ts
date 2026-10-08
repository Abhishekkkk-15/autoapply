import type {
  AutomationState,
  ScrapedJob,
  ApplyStepResult,
  UserProfile,
  AppliedJobRecord,
  McpBridgeStatus,
} from './types';
import {
  getUserProfile,
  saveUserProfile,
  getAppSettings,
} from './storage';
import { db, getAppliedJobs, getContacts } from './db';

type RpcHandler = (payload: any) => Promise<any>;

export class ExtensionMcpBridge {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private port = 8765;
  private status: McpBridgeStatus = {
    connected: false,
    port: 8765,
    activeClients: 0,
  };
  private onStateChangeCallback?: (status: McpBridgeStatus) => void;

  // Registered action handlers that the MCP server can request from the extension
  private handlers = new Map<string, RpcHandler>();

  constructor(port = 8765) {
    this.port = port;
    this.status.port = port;
    this.setupHandlers();
  }

  public setOnStateChange(cb: (status: McpBridgeStatus) => void) {
    this.onStateChangeCallback = cb;
  }

  public getStatus(): McpBridgeStatus {
    return this.status;
  }

  public registerHandler(action: string, handler: RpcHandler) {
    this.handlers.set(action, handler);
  }

  private setupHandlers() {
    this.registerHandler('GET_PROFILE', async () => {
      return await getUserProfile();
    });

    this.registerHandler('UPDATE_PROFILE', async (payload: Partial<UserProfile>) => {
      const current = await getUserProfile();
      const updated = {
        ...current,
        ...payload,
        jobPreferences: {
          ...current.jobPreferences,
          ...(payload.jobPreferences || {}),
        },
        workAuthorization: {
          ...current.workAuthorization,
          ...(payload.workAuthorization || {}),
        },
      };
      await saveUserProfile(updated);
      return updated;
    });

    this.registerHandler('GET_APPLIED_JOBS', async (payload: { limit?: number }) => {
      return await getAppliedJobs(payload?.limit || 100);
    });

    this.registerHandler('GET_CONTACTS', async () => {
      return await getContacts();
    });
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    try {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);

      this.ws.onopen = () => {
        console.log(`[AutoApply AI MCP] Connected to MCP bridge on ws://127.0.0.1:${this.port}`);
        this.status.connected = true;
        this.status.lastPing = Date.now();
        this.isConnecting = false;
        this.notifyState();

        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.send({ type: 'PING', id: Date.now().toString() });
          }
        }, 15000);

        // Send handshake
        this.send({
          type: 'EXTENSION_HELLO',
          payload: { client: 'AutoApply AI Chrome Extension', version: '1.0.0' },
        });
      };

      this.ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'PING') {
            this.status.lastPing = Date.now();
            this.send({ type: 'PONG', id: message.id });
            return;
          }

          if (message.id && message.action) {
            await this.handleIncomingRpc(message.id, message.action, message.payload);
          }
        } catch (err) {
          console.warn('[AutoApply AI MCP] Failed to parse bridge message:', err);
        }
      };

      this.ws.onclose = () => {
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        this.status.connected = false;
        this.isConnecting = false;
        this.notifyState();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        this.status.connected = false;
        this.isConnecting = false;
        this.notifyState();
      };
    } catch {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.status.connected = false;
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status.connected = false;
    this.notifyState();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 4000);
  }

  private notifyState() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.status);
    }
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private async handleIncomingRpc(id: string, action: string, payload: any) {
    const handler = this.handlers.get(action);
    if (!handler) {
      this.send({
        id,
        success: false,
        error: `Unknown action: ${action}`,
      });
      return;
    }

    try {
      const result = await handler(payload);
      this.send({
        id,
        success: true,
        data: result,
      });
    } catch (err: any) {
      this.send({
        id,
        success: false,
        error: err.message || String(err),
      });
    }
  }

  /**
   * Broadcast state update or job parsed event to MCP server
   */
  public broadcastState(state: AutomationState) {
    this.send({
      type: 'STATE_CHANGED',
      payload: state,
    });
  }

  public broadcastJobDetected(job: ScrapedJob) {
    this.send({
      type: 'JOB_DETECTED',
      payload: job,
    });
  }
}
