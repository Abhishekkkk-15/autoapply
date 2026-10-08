# CONTEXT.md - Comprehensive System Architecture & Engineering Context

This document provides complete technical context, architecture specifications, and data flow models for the **AutoApply AI** platform.

---

## 1. System Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL CODING AGENT                           │
│           (Claude Code / Google Antigravity / Cursor / Codex)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ stdio (JSON-RPC)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          MCP SERVER LAYER                              │
│                    (mcp-server/index.ts @ port 8765)                   │
│  - StdioServerTransport                                                │
│  - Local WebSocket Bridge (ws://127.0.0.1:8765)                        │
│  - HTTP Health & Status Endpoint (http://127.0.0.1:8765/health)        │
│  - 16 Programmatic Autonomous Browser Tools                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket RPC
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      CHROME EXTENSION RUNTIME                          │
│                                                                        │
│  ┌────────────────────────┐         ┌───────────────────────────────┐  │
│  │   Side Panel (React)   │         │     Background Service Worker │  │
│  │  - ControllerBar       │◄───────►│  - State Machine Coordinator  │  │
│  │  - ProfileManager      │ runtime │  - Rate Limiter & Safety Cap  │  │
│  │  - JobTrackerTable     │ messaging│ - ExtensionMcpBridge Client │  │
│  │    (Gmail & LinkedIn   │         │  - Dexie & Storage Hub        │  │
│  │     1-Click Outreach)  │         │  - Tab Navigator & Orchestrator│  │
│  │  - SettingsModal       │         └───────────────┬───────────────┘  │
│  └────────────────────────┘                         │ chrome.tabs      │
│                                                     │ messaging        │
│                                                     ▼                  │
│                                     ┌───────────────────────────────┐  │
│                                     │  Content Scripts (Active Tab) │  │
│                                     │  - Platform Detector (SPA)    │  │
│                                     │  - DOM Automation Engine      │  │
│                                     │  - Platform Drivers:          │  │
│                                     │    • LinkedInAdapter          │  │
│                                     │    • WellfoundAdapter         │  │
│                                     │    • NaukriAdapter            │  │
│                                     │    • IndeedAdapter            │  │
│                                     │    • UniversalAtsAdapter      │  │
│                                     │      (Greenhouse, Lever,      │  │
│                                     │       Ashby, Workday, etc.)   │  │
│                                     │  - Outreach Drivers:          │  │
│                                     │    • GmailOutreach (Draft/Send│  │
│                                     │    • LinkedInOutreach (Connect│  │
│                                     └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Layout & Module Responsibilities

```text
auto-apply-ai/
├── entrypoints/
│   ├── background.ts                  # Central orchestrator: tab state, rate limiting, MCP bridging, outreach router
│   ├── sidepanel/                     # React 19 UI mounted in chrome.sidePanel
│   │   ├── index.html                 # HTML root
│   │   ├── main.tsx                   # React root entrypoint
│   │   ├── App.tsx                    # Top navigation, status pill, and tab switcher
│   │   ├── style.css                  # Tailwind styles and scrollbar definitions
│   │   └── components/
│   │       ├── ControllerBar.tsx      # Semi-Auto vs Full-Auto switch, run controls, live log stream
│   │       ├── ProfileManager.tsx     # Contact, work auth, salary, target roles, custom Q&A rules
│   │       ├── JobTrackerTable.tsx    # Applications table, recruiter directory, CSV export, 1-click outreach (Gmail/LinkedIn)
│   │       └── SettingsModal.tsx      # MCP coding agent toggle, direct API keys, jitter timing controls
│   ├── content/
│   │   ├── index.ts                   # Content script bootstrap, SPA route monitor, click-based active job detection
│   │   ├── adapters/
│   │   │   ├── base.ts                # Abstract JobPlatformAdapter interface & preference filtering
│   │   │   ├── linkedin.ts            # LinkedIn Easy Apply & Artdeco combobox handler
│   │   │   ├── wellfound.ts           # Wellfound parser, dual-pane card sync, 150-word pitch injector, infinite scroll
│   │   │   ├── naukri.ts              # Naukri 1-click apply questionnaire handler & recruiter card scraper
│   │   │   ├── indeed.ts              # Indeed Easily Apply multi-step wizard handler (allFrames support)
│   │   │   └── universal.ts           # Universal ATS adapter (Greenhouse, Lever, Ashby, Workday, custom portals)
│   │   └── outreach/
│   │       ├── gmail.ts               # Authenticated browser Gmail automation (compose, populate draft, optional send)
│   │       └── linkedin.ts            # Recruiter LinkedIn profile connection with grounded note or direct chat message
├── mcp-server/
│   └── index.ts                       # 16-tool MCP Server (Stdio) + WebSocket Bridge for external coding agents
├── src/
│   ├── lib/
│   │   ├── mcp-bridge.ts              # WebSocket client bridge inside the Chrome extension
│   │   ├── storage.ts                 # chrome.storage.local persistence service (profile, settings, caps)
│   │   ├── db.ts                      # Dexie DB schema (appliedJobs, contacts, logs) & CSV export
│   │   ├── ai.ts                      # Universal LLM client & strict anti-hallucination truthfulness engine
│   │   ├── dom-utils.ts               # Prototype setters (React/Angular), pointer cascades, wait helpers
│   │   ├── search-urls.ts             # Direct search URL generator with Easy Apply, Remote, and freshness filters
│   │   ├── extractor.ts               # RFC 5322 regex email extractors, recruiter scrapers, posting age parser
│   │   ├── resume-parser.ts           # Hybrid regex + AI resume extraction engine
│   │   └── types.ts                   # Universal TypeScript interfaces and data models
├── scripts/
│   └── sanitize-encoding.js           # Post-build Chromium UTF-8 noncharacter sanitizer
├── wxt.config.ts                      # WXT build configuration & Manifest V3 permissions (https://*/*)
├── package.json
└── tsconfig.json
```

---

## 3. Core Subsystems

### A. Controlled Form Automation (`src/lib/dom-utils.ts`)
Modern web applications built with React, Angular, and Vue override native element property setters with custom accessors. Assigning `element.value = 'abc'` fails because the framework's internal synthetic event loop is not alerted.

**Solution implemented:**
- Access native prototype descriptor directly:
  ```typescript
  const prototype = element instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  
  // Clear React 16/17/18/19 internal value tracker
  const tracker = (element as any)._valueTracker;
  if (tracker) tracker.setValue('');

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.value = value;

  // Full React fiber input capture
  document.execCommand('insertText', false, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  ```
- Dispatches bubbling `input`, `change`, and `blur` events.
- Simulates human interaction through full pointer event cascades:
  `pointerdown` ➔ `mousedown` ➔ `pointerup` ➔ `mouseup` ➔ `click` with randomized coordinates and 50–120ms delays.

---

### B. Platform Adapters (`entrypoints/content/adapters/`)
All drivers inherit from `JobPlatformAdapter`:

1. **LinkedIn Adapter (`linkedin.ts`):**
   - Detects `jobs/search` and `jobs/view`.
   - Identifies `button.jobs-apply-button` with "Easy Apply".
   - Handles multi-step modals: fills text inputs, numbers, select dropdowns, Yes/No radio fieldsets.
   - **Artdeco Combobox Autocomplete:** Types characters, listens for `div[role="listbox"]` / `.artdeco-typeahead__results-list`, and clicks the matching suggestion.
   - **Semi-Auto Halting:** Halts before final submission with an audio chime and visual highlight for user review.

2. **Wellfound Adapter (`wellfound.ts`):**
   - Matches `wellfound.com/jobs` and `angel.co`.
   - **Dual-Pane Search & Card In-Place Sync:** Extracts job cards directly without full page navigation, keeping the content script alive across hundreds of cards.
   - **Learn More & Drawer Inspection:** Opens the job details pane and extracts un-truncated job descriptions, required skills, compensation, and recruiter details.
   - **Pitch Injection:** Injects bespoke 150-word pitch notes into the "Note to recruiter / Why are you interested?" textarea.
   - **Infinite Scroll Engine:** Handles both explicit "Load More" pagination and container-level synthetic scroll observers.

3. **Universal ATS Adapter (`universal.ts`):**
   - Matches **Greenhouse** (`boards.greenhouse.io`), **Lever** (`jobs.lever.co`), **Ashby** (`jobs.ashbyhq.com`), **Workday** (`myworkdayjobs.com`), **SmartRecruiters**, and custom company career portals.
   - Parses field labels using semantic pattern matching (First/Last Name, Email, Phone, LinkedIn, GitHub, Portfolio, Work Authorization, Expected Salary).
   - Injects candidate cover letters and custom questions answers.
   - Detects and advances multi-step ATS wizards and submits applications in semi-auto or full-auto mode.

4. **Naukri Adapter (`naukri.ts`):**
   - Matches `naukri.com`.
   - Handles 1-click apply questionnaires (CTC, experience, location).
   - Scrapes recruiter cards (`.recruiter-details`, `.rec-name`).

5. **Indeed Adapter (`indeed.ts`):**
   - Traverses "Easily apply" popups and multi-page wizard steps.
   - Supported across nested iframes via `allFrames: true`.

---

### C. Recruiter Outreach Engine (`entrypoints/content/outreach/`)

1. **Gmail Outreach (`gmail.ts`):**
   - Operates directly inside the user's authenticated Gmail web session (`mail.google.com`).
   - Automatically clicks the "Compose" button, waits for the compose dialog, populates `to`, `subject`, and formatted email body text.
   - Supports `'draft'` mode (saves as draft for user review before sending) or `'send'` mode (immediately dispatches).
   - Integrated with 1-click "Open in Gmail" action in the Side Panel job tracker.

2. **LinkedIn Outreach (`linkedin.ts`):**
   - Navigates to recruiter/hiring manager LinkedIn profiles (`linkedin.com/in/...`).
   - Automatically triggers the "Connect" / "More" ➔ "Add a note" workflow.
   - Populates grounded, non-hallucinated connection request notes strictly under LinkedIn's 300-character limit.
   - Supports direct chat messaging for existing connections.

---

### D. Anti-Hallucination & Truthfulness Engine (`src/lib/ai.ts`)

To ensure candidates never submit fabricated claims, the AI engine enforces strict factual integrity:
- **Zero Fake Metrics:** Never invents quantitative metrics (e.g., "% latency reduction", "X million users", "$Y revenue") unless explicitly present in the candidate's resume markdown.
- **Zero Invented Credentials:** Never invents unmentioned degrees, universities, previous employers, awards, or certifications.
- **Factual Experience Bounds:** Years of experience with specific technologies are bounded strictly by candidate's verified total experience.
- **Full Context Ingestion:** Removed all artificial character slicing (`.slice(...)`) on job descriptions and resumes, allowing the full job requirements and resume details to inform every response.

---

### E. Autonomous Search & Multi-Page Apply Engine (`entrypoints/background.ts`)

- **Direct Search Query Construction:** `buildJobSearchUrl` builds platform-specific search URLs with pre-applied Easy Apply filters (`f_AL=true` on LinkedIn, `iafilter=1` on Indeed) and optional Remote filter (`f_WT=2`).
- **Batch Deduplication:** Tracks `seenCardIds` across infinite-scroll batches to prevent reprocessing already evaluated cards.
- **Multi-Word Role Matching:** Matches target role whitelist terms across any order or variation in the job title.
- **Posting Age Cutoff:** Enforces a maximum 30-day posting age cutoff (`maxDaysOld`), instantly skipping stale postings.
- **Approval Flow in Semi-Auto:** Pauses at the final Review step and emits `WAITING_APPROVAL`. Once approved (via Side Panel UI button or MCP `autoapply_approve_pending`), the loop seamlessly continues to the next job card.

---

## 4. Intelligence & Heuristic Priority

To ensure 100% operational reliability even when offline or unconfigured, AutoApply AI uses a strict 3-tier hierarchy:

1. **Tier 1: User Custom Q&A Presets (`profile.customAnswers`):**
   - Regex/keyword patterns defined by the user (e.g. `"visa sponsorship"` ➔ `"No"`). Evaluated first with 1.0 confidence.
2. **Tier 2: Deterministic Rule-Based Heuristics:**
   - Standardized questions (experience years, salary expectation, notice period, legal right to work, citizenship, background check consent) are evaluated via static regex matching against `profile` fields.
3. **Tier 3: LLM Reasoning (MCP Coding Agent or Direct API):**
   - Open-ended questions ("Why are you a good fit?"), cover letters, and cold emails are dynamically generated with strict JSON schema validation.

---

## 5. Data Persistence Model

### A. Dexie (IndexedDB) Schema (`src/lib/db.ts`)
- Database: `AutoApplyAIDatabase`
- Tables:
  - `appliedJobs`: `++id, platform, externalJobId, company, status, appliedAt, [platform+externalJobId]`
  - `contacts`: `++id, email, company, platform, extractedAt`
  - `logs`: `++id, timestamp, level` (capped at 1,000 entries)

### B. `chrome.storage.local` Schema (`src/lib/storage.ts`)
- `autoapply_user_profile`: UserProfile (fullName, email, phone, location, links, experience, salary, auth, resumeMarkdown, preferences, customAnswers).
- `autoapply_app_settings`: AppSettings (mode, dailyApplicationCap, applicationsToday, lastApplicationDate, delays, autoSubmit, llmConfig).

---

## 6. Chromium UTF-8 Noncharacter Sanitization

### The Issue
Chromium's extension validator (`base::IsStringUTF8`) checks all content scripts and extension assets during load. If any file contains Unicode "noncharacters" (specifically `\uFFFF`, which libraries like Dexie include in `maxKey`), Chromium rejects the extension with:
`Could not load file 'content-scripts/content.js' for content script. It isn't UTF-8 encoded.`

### The Architectural Solution
1. **Isolated Storage:** Content scripts only import `src/lib/storage.ts` (`chrome.storage.local`), removing Dexie from content script bundles.
2. **Automated Sanitizer Hook:** WXT `build:done` hook and `scripts/sanitize-encoding.js` automatically convert any `[\uFDD0-\uFDEF\uFFFE\uFFFF]` into standard ASCII escape sequences (`\uXXXX`) across all output chunks.
