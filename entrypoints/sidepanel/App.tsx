import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Bot,
  User,
  Table,
  Settings,
  Circle,
  ShieldCheck,
} from 'lucide-react';
import { ControllerBar } from './components/ControllerBar';
import { ProfileManager } from './components/ProfileManager';
import { JobTrackerTable } from './components/JobTrackerTable';
import { SettingsModal } from './components/SettingsModal';
import type { AutomationState, ExtensionMessage } from '@/src/lib/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'controller' | 'profile' | 'tracker' | 'settings'>('controller');
  const [state, setState] = useState<AutomationState>({
    status: 'IDLE',
    mode: 'semi-auto',
    processedCount: 0,
    dailyCount: 0,
    dailyCap: 30,
    currentStepMessage: 'System ready.',
  });

  const [mcpConnected, setMcpConnected] = useState(false);

  const fetchState = () => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' } as ExtensionMessage, (response) => {
      if (response) {
        setState(response);
      }
    });
    chrome.runtime.sendMessage({ type: 'GET_MCP_STATUS' } as ExtensionMessage, (res) => {
      if (res) {
        setMcpConnected(!!res.connected);
      }
    });
  };

  useEffect(() => {
    fetchState();

    let port: chrome.runtime.Port | null = null;
    let keepAliveTimer: any = null;

    const connectPort = () => {
      try {
        port = chrome.runtime.connect({ name: 'sidepanel-keepalive' });
        port.onDisconnect.addListener(() => {
          port = null;
          keepAliveTimer = setTimeout(connectPort, 2000);
        });
      } catch (err) {
        console.warn('Keepalive port error:', err);
      }
    };

    connectPort();

    const pingInterval = setInterval(() => {
      if (port) {
        try {
          port.postMessage({ type: 'PING' });
        } catch {}
      }
      fetchState();
    }, 10000);

    const listener = (message: ExtensionMessage) => {
      if (message.type === 'STATE_UPDATE') {
        setState(message.payload);
      } else if (message.type === 'MCP_STATUS_UPDATE') {
        setMcpConnected(message.payload.connected);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(pingInterval);
      if (keepAliveTimer) clearTimeout(keepAliveTimer);
      if (port) {
        try {
          port.disconnect();
        } catch {}
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto text-slate-900 pb-8">
      {/* Top App Header */}
      <header className="bg-white border-b border-slate-200/90 px-4 py-3 sticky top-0 z-20 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-black text-slate-900 tracking-tight leading-none">
              AutoApply <span className="text-blue-600 font-extrabold">AI</span>
            </h1>
            <span className="text-[10px] text-slate-500 font-medium">
              Autonomous Job Agent
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {mcpConnected && (
            <div
              title="Connected to external Coding Agent (MCP)"
              className="flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-full text-[10px] font-bold"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              MCP Active
            </div>
          )}
          {/* Global Live Status Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-full border border-slate-200/80">
            <Circle
              className={`w-2 h-2 fill-current ${
                state.status === 'RUNNING'
                  ? 'text-blue-500 animate-pulse'
                  : state.status === 'WAITING_APPROVAL'
                  ? 'text-emerald-500 animate-ping'
                  : state.status === 'PAUSED'
                  ? 'text-amber-500'
                  : state.status === 'ERROR'
                  ? 'text-rose-500'
                  : 'text-slate-400'
              }`}
            />
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">
              {state.status === 'WAITING_APPROVAL' ? 'Action Required' : state.status}
            </span>
          </div>
        </div>
      </header>

      {/* Main Tab Bar Navigation */}
      <nav className="bg-white border-b border-slate-200 px-3 py-2 flex items-center justify-between gap-1 shadow-xs">
        <button
          onClick={() => setActiveTab('controller')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition ${
            activeTab === 'controller'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          Control
        </button>

        <button
          onClick={() => setActiveTab('tracker')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition ${
            activeTab === 'tracker'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Table className="w-3.5 h-3.5" />
          Tracker
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition ${
            activeTab === 'profile'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          Profile
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition ${
            activeTab === 'settings'
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </button>
      </nav>

      {/* Dynamic Content Views */}
      <main className="p-3.5 flex-1">
        {activeTab === 'controller' && (
          <ControllerBar state={state} onRefreshState={fetchState} />
        )}
        {activeTab === 'profile' && <ProfileManager />}
        {activeTab === 'tracker' && <JobTrackerTable />}
        {activeTab === 'settings' && <SettingsModal />}
      </main>
    </div>
  );
}
