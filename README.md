# AutoApply AI - Autonomous Browser Extension & MCP Bridge

A production-ready, modular Manifest V3 Chrome Extension and Model Context Protocol (MCP) server built with **WXT (Vite + TypeScript)** and **React 19** that autonomously navigates, parses, generates tailored content for, and applies to jobs across **LinkedIn**, **Wellfound (AngelList)**, **Naukri**, and **Indeed** using the user's active, logged-in browser session.

---

## 🌟 Key Architecture & Highlights

- **Model Context Protocol (MCP) Integration (`mcp-server/index.ts`):**
  - Connect your existing AI coding agent (**Claude Code**, **Google Antigravity CLI**, **Cursor**, **Windsurf**, etc.) directly to the browser extension!
  - **Zero API Keys Required in the Browser:** Your local coding agent provides the reasoning, generates custom cover letters, answers application questionnaires, and reviews job requisitions directly.
  - **Dual Intelligence Modes:** Users can freely choose between connecting their **Coding Agent via MCP** OR using **Direct API Keys** (OpenAI, Anthropic Claude, Groq, local Ollama).
- **Manifest V3 & WXT Framework:** High-performance Vite compilation with Chrome Side Panel API integration (`chrome.sidePanel`).
- **Controlled Component DOM Automation (`src/lib/dom-utils.ts`):**
  - Native prototype property descriptors (`setNativeValue`, `setNativeSelectValue`) to cleanly trigger React, Angular, and Vue state updates.
  - Human-like micro-delays (jitter), realistic multi-stage click simulations (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`), and character-by-character typing emulation.
  - `MutationObserver`-backed DOM watchers (`waitForSelector`) with customizable timeouts.
- **Multi-Platform Scraper & Driver Adapters (`entrypoints/content/adapters/`):**
  - **LinkedIn Adapter (`linkedin.ts`):** Detects job views/searches, navigates multi-step Easy Apply modal flows, auto-fills inputs, radio groups, and dropdowns, with Semi-Auto halting before final submission.
  - **Wellfound Adapter (`wellfound.ts`):** Scrapes role requirements and injects a bespoke 150-word pitch note into the "Why are you interested in this role?" textarea.
  - **Naukri Adapter (`naukri.ts`):** Handles 1-click apply questionnaires and extracts recruiter contact cards from job details.
  - **Indeed Adapter (`indeed.ts`):** Traverses "Easily apply" multi-page modals and form wizard steps.
- **Local Persistence & Privacy First (`src/lib/db.ts` & `src/lib/storage.ts`):**
  - **Dexie.js (IndexedDB):** Stores applied jobs, tailored cover letters, recruiter pitches, cold outreach emails, and execution logs locally on the machine.
  - **`chrome.storage.local`:** Persists user profiles, target job whitelist, company blacklists, custom Q&A rules securely within the browser.
  - **CSV Export:** One-click export of all applied jobs, recruiter emails, and statuses.

---

## 🤖 Model Context Protocol (MCP) Server Setup

Instead of paying for extra API keys, you can connect AutoApply AI directly to your existing coding agent.

### 1. Start the MCP Server

In the project root, run:

```bash
npm run mcp
```

This starts the MCP stdio interface for your coding agent while hosting a local WebSocket bridge (`ws://127.0.0.1:8765`) that connects to the AutoApply AI Chrome extension.

### 2. Configure Your Coding Agent

#### For Claude Code / Claude Desktop
Add this to your `claude_desktop_config.json` (or `.claude.json`):

```json
{
  "mcpServers": {
    "autoapply": {
      "command": "npx",
      "args": ["-y", "tsx", "D:/js/job-applier/mcp-server/index.ts"]
    }
  }
}
```

Or via the Claude Code CLI:
```bash
claude mcp add autoapply -- npx -y tsx D:/js/job-applier/mcp-server/index.ts
```

#### For Cursor
Add this to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "autoapply": {
      "command": "npx",
      "args": ["-y", "tsx", "D:/js/job-applier/mcp-server/index.ts"]
    }
  }
}
```

#### For Google Antigravity CLI / AGY
Add to your Antigravity agent configuration or `mcp_servers` configuration:

```json
{
  "autoapply": {
    "command": "npx",
    "args": ["-y", "tsx", "D:/js/job-applier/mcp-server/index.ts"]
  }
}
```

### 3. Available MCP Tools

Once connected, your coding agent can inspect, guide, and autonomously control job applications using these tools:

| MCP Tool | Description |
|---|---|
| `autoapply_status` | Returns the real-time operational status of the extension, active tab, and application rate limits. |
| `autoapply_get_current_job` | Scrapes and returns full details (title, company, description, recruiter contacts) from the active browser tab. |
| `autoapply_apply_current_job` | Commands the browser extension to apply to the active job in `semi-auto` or `full-auto` mode. |
| `autoapply_approve_pending` | Approves and submits an application that is paused in the review step. |
| `autoapply_get_user_profile` | Retrieves candidate profile, skills, experience, target roles whitelist, and company blacklist. |
| `autoapply_update_user_profile` | Updates candidate profile fields (e.g. adding target roles, changing notice period, editing resume markdown). |
| `autoapply_list_applied_jobs` | Retrieves database records of applied jobs, including dates, statuses, and recruiter cards. |
| `autoapply_queue_control` | Starts, pauses, resumes, or stops the autonomous queue across search results. |

---

## 📁 Repository Structure

```text
auto-apply-ai/
├── entrypoints/
│   ├── background.ts                  # State machine orchestrator, tab coordinator, rate limiter, MCP bridge
│   ├── sidepanel/                     # React Sidepanel Root (mounted via chrome.sidePanel)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx                    # Multi-tab dashboard layout with live MCP indicator
│   │   ├── style.css                  # Tailwind styles and scrollbar formatting
│   │   └── components/
│   │       ├── ControllerBar.tsx      # Semi-Auto / Full-Auto toggles, status indicator, approval banner, logs stream
│   │       ├── ProfileManager.tsx     # Clean profile forms, work authorization, salary, target roles, custom Q&A
│   │       ├── JobTrackerTable.tsx    # Applied jobs table, recruiter contacts list, CSV export, artifacts drawer
│   │       └── SettingsModal.tsx      # MCP Coding Agent router, Direct API key selector, models, jitter sliders
│   ├── content/
│   │   ├── index.ts                   # Content script bootstrap, SPA route detector, and message dispatcher
│   │   └── adapters/
│   │       ├── base.ts                # Abstract JobPlatformAdapter interface & preference filtering
│   │       ├── linkedin.ts            # LinkedIn Easy Apply & job parser
│   │       ├── wellfound.ts           # Wellfound (AngelList) parser & modal note injector
│   │       ├── naukri.ts              # Naukri 1-click apply questionnaire handler & recruiter card scraper
│   │       └── indeed.ts              # Indeed Easily Apply multi-step wizard handler
├── mcp-server/
│   └── index.ts                       # MCP Server (Stdio) + WebSocket Bridge for coding agents
├── src/
│   ├── lib/
│   │   ├── mcp-bridge.ts              # Extension-side WebSocket client bridge
│   │   ├── storage.ts                 # chrome.storage.local persistence service
│   │   ├── db.ts                      # Dexie DB schema, repositories, and CSV export
│   │   ├── ai.ts                      # Universal LLM client & deterministic fallback heuristics
│   │   ├── dom-utils.ts               # Synthetic event dispatchers, scroll/click jitter, wait helpers
│   │   ├── extractor.ts               # Heuristic extractors for RFC 5322 emails and recruiter profiles
│   │   └── types.ts                   # Universal interfaces and data models
├── scripts/
│   └── sanitize-encoding.js           # Post-build Chromium UTF-8 sanitizer
├── wxt.config.ts                      # WXT build configuration & Manifest V3 permissions
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started

### 1. Installation

```bash
cd D:/js/job-applier
npm install
```

### 2. Build Extension

```bash
npm run build
```

The output extension files are placed in `.output/chrome-mv3`.

### 3. Load in Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the upper right corner.
3. Click **Load unpacked** and select:
   ```text
   D:\js\job-applier\.output\chrome-mv3
   ```
4. Click the **AutoApply AI** extension icon in your toolbar to open the Side Panel dashboard.

---

## ⚙️ Operating Modes

### 🤖 Coding Agent Mode (via MCP)
1. In the Side Panel, go to the **Settings** tab.
2. Under **AI Provider**, select **Coding Agent (MCP - Claude Code, Antigravity, Cursor)**.
3. Start the MCP server: `npm run mcp`.
4. Your extension displays a glowing **"MCP Active"** pill, and all reasoning is driven through your coding assistant with zero API keys required.

### 🛡️ Semi-Auto Mode (Recommended)
- Autonomous navigation and form filling across all steps.
- Automatically halts before final submission when reaching the review stage.
- Emits an audio alert and visually highlights the active dialog in green.
- Displays an **"Approve & Submit Now"** prompt directly within the Side Panel.

### ⚡ Full-Auto Mode
- Completely autonomous end-to-end execution.
- Automatically completes and submits applications.
- Enforces strict daily application caps (e.g., 30 applications/day) with human-like jitter delays to prevent platform rate limits and account bans.
