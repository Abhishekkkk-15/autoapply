import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Send,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ShieldAlert,
  Briefcase,
  Building,
  MapPin,
  Clock,
  Terminal,
  Trash2,
  Check,
  X,
  ExternalLink,
} from 'lucide-react';
import type {
  AutomationState,
  ExecutionLog,
  ExtensionMessage,
  AppSettings,
} from '@/src/lib/types';
import { getAppSettings, saveAppSettings, getRecentLogs, clearLogs } from '@/src/lib/db';

interface ControllerBarProps {
  state: AutomationState;
  onRefreshState: () => void;
}

export const ControllerBar: React.FC<ControllerBarProps> = ({
  state,
  onRefreshState,
}) => {
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  useEffect(() => {
    loadSettings();
    loadLogs();

    // Listen for live log events
    const logListener = (message: ExtensionMessage) => {
      if (message.type === 'LOG_EVENT') {
        setLogs((prev) => [message.payload, ...prev.slice(0, 99)]);
      }
    };
    chrome.runtime.onMessage.addListener(logListener);

    return () => {
      chrome.runtime.onMessage.removeListener(logListener);
    };
  }, []);

  const loadSettings = async () => {
    const s = await getAppSettings();
    setSettings(s);
  };

  const loadLogs = async () => {
    const l = await getRecentLogs(50);
    setLogs(l);
  };

  const handleToggleMode = async (newMode: 'semi-auto' | 'full-auto') => {
    if (!settings) return;
    const updated = await saveAppSettings({ mode: newMode });
    setSettings(updated);
    onRefreshState();
  };

  const handleApplyCurrentTab = () => {
    chrome.runtime.sendMessage({
      type: 'EXECUTE_APPLY_ON_CURRENT_TAB',
      payload: { mode: settings?.mode || 'semi-auto' },
    } as ExtensionMessage);
  };

  const handleStartQueue = () => {
    chrome.runtime.sendMessage({
      type: 'START_QUEUE',
      payload: { mode: settings?.mode || 'semi-auto' },
    } as ExtensionMessage);
  };

  const handlePauseQueue = () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_QUEUE' } as ExtensionMessage);
  };

  const handleResumeQueue = () => {
    chrome.runtime.sendMessage({ type: 'RESUME_QUEUE' } as ExtensionMessage);
  };

  const handleStopQueue = () => {
    chrome.runtime.sendMessage({ type: 'STOP_QUEUE' } as ExtensionMessage);
  };

  const handleApproveSubmission = () => {
    setIsSubmittingApproval(true);
    chrome.runtime.sendMessage(
      { type: 'SUBMIT_PENDING_APPROVAL' } as ExtensionMessage,
      () => {
        setIsSubmittingApproval(false);
        onRefreshState();
      }
    );
  };

  const handleCancelApproval = () => {
    chrome.runtime.sendMessage({
      type: 'CANCEL_PENDING_APPROVAL',
    } as ExtensionMessage);
    onRefreshState();
  };

  const handleClearLogs = async () => {
    await clearLogs();
    setLogs([]);
  };

  // Status Badge Configuration
  const getStatusBadge = () => {
    switch (state.status) {
      case 'RUNNING':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
            Autonomous Engine Running
          </div>
        );
      case 'WAITING_APPROVAL':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300 animate-bounce">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            Waiting for Your Approval!
          </div>
        );
      case 'PAUSED':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
            <Pause className="w-3.5 h-3.5" />
            Paused
          </div>
        );
      case 'ERROR':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            Attention Needed
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Idle
          </div>
        );
    }
  };

  const dailyPercent = Math.min(
    100,
    Math.round(((state.dailyCount || 0) / (state.dailyCap || 30)) * 100)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Header Status & Safety Meter */}
      <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              AutoApply Orchestrator
            </h2>
          </div>
          {getStatusBadge()}
        </div>

        <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100 font-medium">
          {state.currentStepMessage}
        </p>

        {/* Rate limit cap indicator */}
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
              Daily Safety Limit
            </span>
            <span className="font-semibold text-slate-700">
              {state.dailyCount || 0} / {state.dailyCap || 30} applied
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                dailyPercent >= 90
                  ? 'bg-rose-500'
                  : dailyPercent >= 70
                  ? 'bg-amber-500'
                  : 'bg-blue-600'
              }`}
              style={{ width: `${dailyPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Urgent Approval Action Banner (Shown when waiting for review) */}
      {state.status === 'WAITING_APPROVAL' && (
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-xl shadow-md flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-2 bg-emerald-500 text-white rounded-lg">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-emerald-950">
                Action Required: Review Application
              </h3>
              <p className="text-xs text-emerald-700 mt-0.5">
                Form filled and verified. Inspect the highlighted modal in your active tab or approve to submit!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleApproveSubmission}
              disabled={isSubmittingApproval}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {isSubmittingApproval ? 'Submitting...' : 'Approve & Submit Now'}
            </button>
            <button
              onClick={handleCancelApproval}
              className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 3. Mode Toggle & Main Controls */}
      <div className="p-4 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-3.5">
        {/* Semi-Auto vs Full-Auto Radio/Switch */}
        <div className="flex items-center justify-between bg-slate-100/90 p-1 rounded-lg">
          <button
            onClick={() => handleToggleMode('semi-auto')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${
              settings?.mode === 'semi-auto'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🛡️ Semi-Auto (Review First)
          </button>
          <button
            onClick={() => handleToggleMode('full-auto')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${
              settings?.mode === 'full-auto'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ⚡ Full-Auto (Direct Submit)
          </button>
        </div>

        {/* Primary Action Buttons */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={handleApplyCurrentTab}
            disabled={state.status === 'RUNNING'}
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Apply This Tab
          </button>

          {state.status === 'RUNNING' ? (
            <button
              onClick={handlePauseQueue}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm transition"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
          ) : state.status === 'PAUSED' ? (
            <button
              onClick={handleResumeQueue}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
          ) : (
            <button
              onClick={handleStartQueue}
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-bold rounded-lg shadow-sm transition"
            >
              <Play className="w-4 h-4" />
              Start Queue
            </button>
          )}
        </div>

        {state.status !== 'IDLE' && (
          <button
            onClick={handleStopQueue}
            className="w-full py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-md border border-rose-200 transition"
          >
            Stop Auto-Apply
          </button>
        )}
      </div>

      {/* 4. Currently Detected Job Card */}
      {state.currentJob && (
        <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Active Job Detected
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                state.currentJob.platform === 'linkedin'
                  ? 'bg-blue-100 text-blue-800'
                  : state.currentJob.platform === 'wellfound'
                  ? 'bg-rose-100 text-rose-800'
                  : state.currentJob.platform === 'naukri'
                  ? 'bg-sky-100 text-sky-800'
                  : 'bg-indigo-100 text-indigo-800'
              }`}
            >
              {state.currentJob.platform}
            </span>
          </div>

          <div className="flex flex-col">
            <h4 className="text-sm font-bold text-slate-900 line-clamp-1">
              {state.currentJob.title}
            </h4>
            <div className="flex items-center gap-3 text-xs text-slate-600 mt-1">
              <span className="flex items-center gap-1">
                <Building className="w-3 h-3 text-slate-400" />
                {state.currentJob.company}
              </span>
              <span className="flex items-center gap-1 line-clamp-1">
                <MapPin className="w-3 h-3 text-slate-400" />
                {state.currentJob.location}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
            <span
              className={`flex items-center gap-1 text-[11px] font-medium ${
                state.currentJob.canEasyApply
                  ? 'text-emerald-700'
                  : 'text-amber-700'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {state.currentJob.canEasyApply
                ? 'Easy Apply Ready'
                : 'Standard / External Apply'}
            </span>
            {state.currentJob.jobUrl && (
              <a
                href={state.currentJob.jobUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-[11px]"
              >
                View <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* 5. Live Execution Logs Console */}
      <div className="bg-slate-950 text-slate-200 rounded-xl p-3 shadow-md flex flex-col gap-2 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-[11px]">Execution Stream</span>
          </div>
          <button
            onClick={handleClearLogs}
            title="Clear logs"
            className="text-slate-500 hover:text-slate-300 transition"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        <div className="h-44 overflow-y-auto space-y-1.5 pr-1 text-[11px]">
          {logs.length === 0 ? (
            <p className="text-slate-600 italic">No execution events yet...</p>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-1.5 leading-tight">
                <span className="text-slate-500 text-[10px] shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={`font-semibold shrink-0 ${
                    log.level === 'error'
                      ? 'text-rose-400'
                      : log.level === 'warn'
                      ? 'text-amber-400'
                      : log.level === 'success'
                      ? 'text-emerald-400'
                      : 'text-blue-400'
                  }`}
                >
                  [{log.level.toUpperCase()}]
                </span>
                <span className="text-slate-300 break-words">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
