# AutoApply AI - Autonomous Browser Extension & MCP Bridge

A production-ready, modular Manifest V3 Chrome Extension and Model Context Protocol (MCP) server built with **WXT (Vite + TypeScript)** and **React 19** that autonomously navigates, parses, generates tailored content for, and applies to jobs across **LinkedIn**, **Wellfound (AngelList)**, **Naukri**, and **Indeed** using the user's active, logged-in browser session.

---

## 🌟 Key Architecture & Highlights

- **Model Context Protocol (MCP) Integration (`mcp-server/index.ts`):**
  - Connect your existing AI coding agent (**Claude Code**, **Google Antigravity CLI**, **Cursor**, **Windsurf**, etc.) directly to the browser extension!
  - **Zero API Keys Required in the Browser:** Your local coding agent provides the reasoning, generates custom cover letters, answers application questionnaires, and reviews job requisitions directly in its own session.
  - **Dual Intelligence Modes:** Defaults out-of-the-box to **Coding Agent via MCP** (`ws://127.0.0.1:8765`), with optional fallback to **Direct API Keys** (OpenAI, Anthropic Claude, Groq, local Ollama) or local heuristics.
- **Autonomous Multi-Page Search & Apply Engine (`src/lib/search-urls.ts`):**
  - Formulates deep search queries with Easy Apply (`f_AL=true`) and Remote (`f_WT=2`) platform filters.
  - Navigates search result cards, deduplicates against previous application history in Dexie DB, handles multi-page pagination, and applies continuously until session ceilings are reached.
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

| MCP Tool | Parameters | Description |
|---|---|---|
| `autoapply_status` | _none_ | Returns the real-time operational status of the extension, active tab, bridge connectivity, and daily limits. |
| `autoapply_get_current_job` | _none_ | Scrapes and returns full details (`title`, `company`, `location`, `jobDescription`, `extractedContacts`, `canEasyApply`) from the active tab. |
| `autoapply_apply_current_job` | `mode` (`'semi-auto'` \| `'full-auto'`), `customPitch?`, `customCoverLetter?`, `customAnswers?` | Commands the browser extension to apply to the active job. The agent can inject its own bespoke pitch notes, tailored cover letters, and answers for tricky open-ended questions. |
| `autoapply_approve_pending` | _none_ | Approves and completes submission for an application currently paused at the review step (`WAITING_APPROVAL`). |
| `autoapply_get_user_profile` | _none_ | Retrieves candidate profile, skills, experience, target roles whitelist, and company blacklist. |
| `autoapply_update_user_profile` | `profile` (partial `UserProfile`) | Updates candidate profile fields (e.g. adding target roles, changing notice period, editing resume markdown). |
| `autoapply_list_applied_jobs` | `limit?` (number) | Retrieves database records of applied jobs from local Dexie DB, including dates, statuses, and recruiter cards. |
| `autoapply_save_job_artifacts` | `platform`, `externalJobId`, `coldEmail?`, `coverLetter?`, `pitchNote?`, `linkedinConnectionNote?`, `notes?`, `status?` | Saves agent-generated cold outreach emails, LinkedIn connection notes, and candidate fit scores directly into the applied job database record. |
| `autoapply_queue_control` | `action` (`'start'` \| `'pause'` \| `'resume'` \| `'stop'`) | Controls bulk queue navigation across search results. |
| `autoapply_search_and_apply` | `query`, `location?`, `platform?`, `mode?`, `maxJobs?`, `remoteOnly?` | Autonomously initiates a platform search with Easy-Apply and Remote filters, iterates through search result cards, evaluates candidate fit, handles pagination, and applies across multiple pages. |

---

## 💡 Autonomous Coding Agent Workflows (Zero API Keys)

When running Claude Code, Google Antigravity CLI, or Cursor, your coding agent uses its own frontier LLM intelligence to execute AI tasks with **$0 extra API bills**:

### Workflow A: Autonomous Search & Multi-Page Apply
Ask your coding agent:
> *"Find remote React developer jobs on LinkedIn and apply to 5 matching roles."*

The agent calls:
```json
{
  "query": "React Developer",
  "location": "Remote",
  "platform": "linkedin",
  "remoteOnly": true,
  "maxJobs": 5,
  "mode": "semi-auto"
}
```
The extension automatically opens LinkedIn with Easy-Apply (`f_AL=true`) and Remote (`f_WT=2`) filters, iterates through job cards, deduplicates against previous applications, fills forms, pauses for approval (if semi-auto), and paginates through search pages until 5 applications are completed.

### Workflow B: Job Fit Evaluation, Bespoke Pitch & Recruiter Cold Outreach
Ask your coding agent:
> *"Look at the job on my screen. If it matches my resume, apply with a tailored pitch and draft a cold email to the recruiter."*

1. **Inspect & Evaluate:** Agent calls `autoapply_get_current_job` and `autoapply_get_user_profile`. It compares required skills against your resume markdown and calculates a fit score (e.g. 92%).
2. **Apply with Custom Content:** Agent calls `autoapply_apply_current_job`:
   ```json
   {
     "mode": "semi-auto",
     "customPitch": "I have 5 years of full-stack TypeScript experience...",
     "customAnswers": [
       { "questionPattern": "sponsorship", "answer": "No" },
       { "questionPattern": "years with React", "answer": "5" }
     ]
   }
   ```
3. **Save Recruiter Outreach:** Agent drafts a tailored cold email and a 280-char LinkedIn note from `job.extractedContacts`, then calls `autoapply_save_job_artifacts`. All artifacts are instantly saved to local IndexedDB and visible in your Side Panel!

---

## 📁 Repository Structure

```text
auto-apply-ai/
├── AGENTS.md                          # Guidance and tool usage specifications for AI coding agents
├── CONTEXT.md                         # Technical architecture, lifecycle invariants, and schema reference
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
│   │   ├── search-urls.ts             # Platform search query URL generators & pagination handlers
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

### 🤖 Coding Agent Mode (via MCP) — *Default Out-of-the-Box*
- **Default AI Provider:** Preconfigured out-of-the-box (`provider: 'mcp'`), so no manual configuration or third-party API keys are required.
- **Start the Bridge:** Run `npm run mcp` in your terminal.
- **Connection:** The Side Panel displays a glowing green **"MCP Active"** badge when connected.
- **Zero API Key Cost:** Your coding agent (Claude Code, Google Antigravity CLI, Cursor) directly handles evaluating match scores, crafting custom pitch notes, answering form questions, and drafting recruiter cold outreach emails.

### 🛡️ Semi-Auto Mode (Recommended)
- Autonomous navigation and form filling across all steps.
- Automatically halts before final submission when reaching the review stage.
- Emits an audio alert and visually highlights the active dialog in green.
- Displays an **"Approve & Submit Now"** prompt directly within the Side Panel.

### ⚡ Full-Auto Mode
- Completely autonomous end-to-end execution.
- Automatically completes and submits applications.
- Enforces strict daily application caps (e.g., 30 applications/day) with human-like jitter delays to prevent platform rate limits and account bans.
