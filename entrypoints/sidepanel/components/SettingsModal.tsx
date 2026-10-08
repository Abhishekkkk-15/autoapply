import React, { useState, useEffect } from 'react';
import {
  Save,
  Key,
  Cpu,
  Clock,
  ShieldAlert,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Zap,
  Terminal,
  Radio,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { AppSettings, LLMProvider, McpBridgeStatus, ExtensionMessage } from '@/src/lib/types';
import { getAppSettings, saveAppSettings, DEFAULT_APP_SETTINGS } from '@/src/lib/db';
import { callLLMJson } from '@/src/lib/ai';

export const SettingsModal: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpBridgeStatus>({
    connected: false,
    port: 8765,
    activeClients: 0,
  });

  useEffect(() => {
    getAppSettings().then((s) => setSettings(s));
    checkMcpStatus();

    const listener = (msg: ExtensionMessage) => {
      if (msg.type === 'MCP_STATUS_UPDATE') {
        setMcpStatus(msg.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const checkMcpStatus = () => {
    chrome.runtime.sendMessage({ type: 'GET_MCP_STATUS' }, (res) => {
      if (res) setMcpStatus(res);
    });
  };

  const handleReconnectMcp = () => {
    chrome.runtime.sendMessage({ type: 'RECONNECT_MCP' }, () => {
      setTimeout(checkMcpStatus, 800);
    });
  };

  const handleProviderChange = (provider: LLMProvider) => {
    let baseUrl = settings.llmConfig.baseUrl;
    let model = settings.llmConfig.model;

    if (provider === 'mcp') {
      baseUrl = `ws://127.0.0.1:${settings.llmConfig.mcpBridgePort || 8765}`;
      model = 'coding-agent-mcp';
    } else if (provider === 'openai') {
      baseUrl = 'https://api.openai.com/v1';
      model = 'gpt-4o-mini';
    } else if (provider === 'claude') {
      baseUrl = 'https://api.anthropic.com/v1';
      model = 'claude-3-5-sonnet-latest';
    } else if (provider === 'azure') {
      baseUrl = 'https://abhishek-0588-resource.openai.azure.com/openai/v1';
      model = 'gpt-4o';
    } else if (provider === 'groq') {
      baseUrl = 'https://api.groq.com/openai/v1';
      model = 'llama-3.3-70b-versatile';
    } else if (provider === 'ollama') {
      baseUrl = 'http://localhost:11434/v1';
      model = 'llama3.2';
    }

    setSettings({
      ...settings,
      llmConfig: {
        ...settings.llmConfig,
        provider,
        baseUrl,
        model,
      },
    });
  };

  const handleSave = async () => {
    const updated = await saveAppSettings(settings);
    setSettings(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    if (settings.llmConfig.provider === 'mcp') {
      checkMcpStatus();
      setTimeout(() => {
        setIsTesting(false);
        if (mcpStatus.connected) {
          setTestResult({
            ok: true,
            message: `Connected to MCP Bridge on port ${mcpStatus.port}! Coding agent ready.`,
          });
        } else {
          setTestResult({
            ok: false,
            message: `MCP Bridge server not responding on ws://127.0.0.1:${mcpStatus.port}. Run "npm run mcp" in your terminal.`,
          });
        }
      }, 500);
      return;
    }

    try {
      const response = await callLLMJson<{ status: string; reply: string }>(
        'You are a testing assistant. Return {"status": "ok", "reply": "Connection verified successfully!"}',
        'Ping',
        settings.llmConfig
      );

      if (response && response.status === 'ok') {
        setTestResult({
          ok: true,
          message: `Success! ${response.reply || 'Connected'}`,
        });
      } else {
        setTestResult({
          ok: true,
          message: 'Connected and responded with valid JSON.',
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err.message || 'Connection test failed. Check API key & URL.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm">
        <div>
          <h2 className="text-sm font-bold text-slate-900">System & AI Settings</h2>
          <p className="text-[11px] text-slate-500">Configure LLM keys, MCP coding agent, and safety caps</p>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-sm transition active:scale-95"
        >
          {saveSuccess ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-200" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save
            </>
          )}
        </button>
      </div>

      {/* 1. LLM Provider Configuration */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-3">
        <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
          <Cpu className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            Intelligence Router
          </h3>
        </div>

        <div>
          <label className="block text-slate-600 font-semibold mb-1">AI Provider</label>
          <select
            value={settings.llmConfig.provider}
            onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 bg-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="mcp">🤖 Coding Agent (MCP - Claude Code, Antigravity, Cursor) [NO API KEY REQUIRED]</option>
            <option value="azure">Azure OpenAI (abhishek-0588-resource)</option>
            <option value="openai">OpenAI Direct API (GPT-4o, GPT-4o-mini)</option>
            <option value="claude">Anthropic Claude Direct API (Sonnet 3.5)</option>
            <option value="groq">Groq Fast Inference (Llama 3.3 70B)</option>
            <option value="ollama">Local Ollama (Offline / Private)</option>
            <option value="custom">Custom OpenAI-Compatible Endpoint</option>
          </select>
        </div>

        {/* Dedicated MCP Coding Agent Bridge Card */}
        {settings.llmConfig.provider === 'mcp' && (
          <div className="p-3.5 bg-gradient-to-r from-indigo-50/70 to-blue-50/70 rounded-xl border border-indigo-200 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-950 flex items-center gap-1.5 text-xs">
                <Radio className={`w-3.5 h-3.5 ${mcpStatus.connected ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
                MCP Bridge Status
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    mcpStatus.connected
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {mcpStatus.connected ? `Connected (Port ${mcpStatus.port})` : 'Offline / Waiting'}
                </span>
                <button
                  onClick={handleReconnectMcp}
                  title="Reconnect"
                  className="p-1 hover:bg-white rounded text-slate-500 hover:text-slate-700 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              <strong>Zero API Keys Needed:</strong> Connects directly to your active coding assistant
              (Claude Code, Antigravity CLI, Codex, Cursor). The agent uses its existing context and intelligence
              to generate tailored cover letters, fill job questions, and review applications.
            </p>

            <div className="bg-slate-950 text-slate-200 p-2.5 rounded-lg font-mono text-[11px] flex flex-col gap-1">
              <span className="text-slate-400 text-[10px]"># Start the MCP server in your terminal:</span>
              <span className="text-emerald-400 select-all font-semibold">npm run mcp</span>
            </div>
          </div>
        )}

        {/* Standard API Key and Base URL inputs (Hidden when in MCP mode) */}
        {settings.llmConfig.provider !== 'mcp' && (
          <>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Base URL</label>
              <input
                type="text"
                value={settings.llmConfig.baseUrl}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    llmConfig: { ...settings.llmConfig, baseUrl: e.target.value },
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono text-[11px] focus:ring-2 focus:ring-blue-500"
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                API Key {settings.llmConfig.provider === 'ollama' && '(Optional for local)'}
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.llmConfig.apiKey}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      llmConfig: { ...settings.llmConfig, apiKey: e.target.value },
                    })
                  }
                  className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono text-[11px] focus:ring-2 focus:ring-blue-500"
                  placeholder={
                    settings.llmConfig.provider === 'claude' ? 'sk-ant-api...' : 'sk-...'
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Model Name</label>
              <input
                type="text"
                value={settings.llmConfig.model}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    llmConfig: { ...settings.llmConfig, model: e.target.value },
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono text-[11px] focus:ring-2 focus:ring-blue-500"
                placeholder="gpt-4o-mini"
              />
            </div>
          </>
        )}

        {/* Test Connection Button */}
        <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-lg transition disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            {isTesting
              ? 'Verifying...'
              : settings.llmConfig.provider === 'mcp'
              ? 'Ping MCP Bridge Server'
              : 'Test API Connection'}
          </button>

          {testResult && (
            <div
              className={`p-2.5 rounded-lg text-[11px] flex items-start gap-2 ${
                testResult.ok
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="break-words">{testResult.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Rate Limiting & Delays */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-3">
        <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
            Anti-Ban Safety Controls
          </h3>
        </div>

        <div>
          <div className="flex justify-between font-semibold text-slate-700 mb-1">
            <span>Daily Application Hard Cap</span>
            <span className="text-blue-600 font-bold">
              {settings.dailyApplicationCap} applications/day
            </span>
          </div>
          <input
            type="range"
            min="5"
            max="100"
            step="5"
            value={settings.dailyApplicationCap}
            onChange={(e) =>
              setSettings({ ...settings, dailyApplicationCap: Number(e.target.value) })
            }
            className="w-full accent-blue-600 cursor-pointer"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Hard cutoff stops execution to prevent automated account suspicion.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Min Delay (sec)</label>
            <input
              type="number"
              min="1"
              max="20"
              value={settings.minDelaySeconds}
              onChange={(e) =>
                setSettings({ ...settings, minDelaySeconds: Number(e.target.value) })
              }
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Max Delay (sec)</label>
            <input
              type="number"
              min="2"
              max="40"
              value={settings.maxDelaySeconds}
              onChange={(e) =>
                setSettings({ ...settings, maxDelaySeconds: Number(e.target.value) })
              }
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
