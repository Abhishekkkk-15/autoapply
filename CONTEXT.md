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
│  │  - SettingsModal       │         │  - Dexie & Storage Hub        │  │
│  └────────────────────────┘         └───────────────┬───────────────┘  │
│                                                     │ chrome.tabs      │
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
│                                     └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Layout & Module Responsibilities

```text
auto-apply-ai/
├── entrypoints/
│   ├── background.ts                  # Central orchestrator: tab state, rate limiting, MCP bridging
│   ├── sidepanel/                     # React 19 UI mounted in chrome.sidePanel
│   │   ├── index.html                 # HTML root
│   │   ├── main.tsx                   # React root entrypoint
│   │   ├── App.tsx                    # Top navigation, status pill, and tab switcher
│   │   ├── style.css                  # Tailwind styles and scrollbar definitions
│   │   └── components/
│   │       ├── ControllerBar.tsx      # Semi-Auto vs Full-Auto switch, run controls, live log stream
│   │       ├── ProfileManager.tsx     # Contact, work auth, salary, target roles, custom Q&A rules
│   │       ├── JobTrackerTable.tsx    # Applications table, recruiter directory, CSV export, artifacts drawer
│   │       └── SettingsModal.tsx      # MCP coding agent toggle, direct API keys, jitter timing controls
│   ├── content/
│   │   ├── index.ts                   # Content script bootstrap, SPA route monitor (allFrames: true)
│   │   └── adapters/
│   │       ├── base.ts                # Abstract JobPlatformAdapter interface & preference filtering
│   │       ├── linkedin.ts            # LinkedIn Easy Apply & Artdeco combobox handler
│   │       ├── wellfound.ts           # Wellfound (AngelList) parser & 150-word pitch injector
│   │       ├── naukri.ts              # Naukri 1-click apply questionnaire handler & recruiter card scraper
│   │       └── indeed.ts              # Indeed Easily Apply multi-step wizard handler
├── mcp-server/
│   └── index.ts                       # MCP Server (Stdio) + WebSocket Bridge for external coding agents
├── src/
│   ├── lib/
│   │   ├── mcp-bridge.ts              # WebSocket client bridge inside the Chrome extension
│   │   ├── storage.ts                 # chrome.storage.local persistence service (profile, settings, caps)
│   │   ├── db.ts                      # Dexie DB schema (appliedJobs, contacts, logs) & CSV export
│   │   ├── ai.ts                      # Universal LLM client (OpenAI, Claude, Groq, Ollama) & deterministic fallbacks
│   │   ├── dom-utils.ts               # Prototype setters (React/Angular), pointer cascades, wait helpers
│   │   ├── search-urls.ts             # Direct search URL generator with Easy Apply & Remote filters
│   │   ├── extractor.ts               # RFC 5322 regex email extractors and recruiter profile scrapers
│   │   └── types.ts                   # Universal TypeScript interfaces and data models
├── scripts/
│   └── sanitize-encoding.js           # Post-build Chromium UTF-8 noncharacter sanitizer
├── wxt.config.ts                      # WXT build configuration & Manifest V3 permissions
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
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  ```
- Dispatch bubbling `input`, `change`, and `blur` events.
- Simulate human interaction through full pointer event cascades:
  `pointerdown` ➔ `mousedown` ➔ `pointerup` ➔ `mouseup` ➔ `click` with randomized coordinates and 50–120ms delays.

### B. Platform Adapters (`entrypoints/content/adapters/`)
All drivers inherit from `JobPlatformAdapter`:
```typescript
export abstract class JobPlatformAdapter {
  abstract readonly platform: Platform;
  abstract isMatch(): boolean;
  abstract parseCurrentJob(): Promise<ScrapedJob | null>;
  abstract canAutoApply(): boolean;
  abstract executeApplyStep(profile: UserProfile, isSemiAuto: boolean): Promise<ApplyStepResult>;
}
```

1. **LinkedIn Adapter ([linkedin.ts](file:///D:/js/job-applier/entrypoints/content/adapters/linkedin.ts)):**
   - Detects `jobs/search` and `jobs/view`.
   - Identifies `button.jobs-apply-button` with "Easy Apply".
   - Handles multi-step modals: fills text inputs, numbers, select dropdowns, Yes/No radio fieldsets.
   - **Artdeco Combobox Autocomplete:** Types characters, listens for `div[role="listbox"]` / `.artdeco-typeahead__results-list`, and clicks the first suggestion.
   - **Semi-Auto Halting:** Halts before final submission with an audio chime and visual highlight for user review.

2. **Wellfound Adapter ([wellfound.ts](file:///D:/js/job-applier/entrypoints/content/adapters/wellfound.ts)):**
   - Matches `wellfound.com/jobs` and `angel.co`.
   - Generates and injects a bespoke 150-word pitch into Wellfound's "Note to recruiter / Why are you interested in this role?" textarea.

3. **Naukri Adapter ([naukri.ts](file:///D:/js/job-applier/entrypoints/content/adapters/naukri.ts)):**
   - Matches `naukri.com`.
   - Handles 1-click apply questionnaires (CTC, experience, location).
   - Scrapes recruiter cards (`.recruiter-details`, `.rec-name`).

4. **Indeed Adapter ([indeed.ts](file:///D:/js/job-applier/entrypoints/content/adapters/indeed.ts)):**
   - Traverses "Easily apply" popups and multi-page wizard steps.
   - Supported across nested iframes via `allFrames: true`.

### E. Autonomous Search & Multi-Page Apply Engine (`entrypoints/background.ts` & adapters)
- **Direct Search Query Construction:** `buildJobSearchUrl` builds platform-specific search URLs with pre-applied Easy Apply filters (`f_AL=true` on LinkedIn, `iafilter=1` on Indeed) and optional Remote filter (`f_WT=2`).
- **Card-by-Card Traversal:** Asks content script for visible job cards on the page, smoothly scrolls each into view, simulates real user click, and waits for detail pane hydration.
- **Three-Tier Pre-Apply Filtering:**
  1. *Deduplication:* Checks IndexedDB (`db.appliedJobs`) to avoid re-applying.
  2. *Preference & Blacklist:* Verifies company blacklist and target roles whitelist.
  3. *Easy Apply Verification:* Confirms 1-click / Easy Apply modal presence.
- **Approval Flow in Semi-Auto:** Pauses at the final Review step and emits `WAITING_APPROVAL`. Once approved (via Side Panel UI button or MCP `autoapply_approve_pending`), the loop seamlessly continues to the next job card.
- **Multi-Page Pagination:** Automatically clicks "Next Page" or increments URL pagination offset (`&start=25` / `&start=10`) when all cards on the current page are processed.

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
