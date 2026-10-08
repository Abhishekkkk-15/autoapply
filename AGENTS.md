# AGENTS.md - Agent Instructions & MCP Tool Guide

This document is the official guidance for autonomous AI agents (Claude Code, Google Antigravity CLI, Cursor Agent, Codex, Windsurf) interacting with or contributing to the **AutoApply AI** codebase.

---

## 1. Project Purpose & Core Architecture

AutoApply AI is an autonomous, production-ready Manifest V3 Chrome Extension and Model Context Protocol (MCP) server. It enables AI coding agents to control browser sessions to parse, tailor content for, and apply to job openings across **LinkedIn**, **Wellfound**, **Naukri**, and **Indeed**.

### Tech Stack
- **Framework:** WXT (Vite + TypeScript) targeting Manifest V3.
- **UI & Dashboard:** React 19, Tailwind CSS, Lucide icons, mounted inside `chrome.sidePanel`.
- **Database & Storage:**
  - `dexie` (IndexedDB): applied jobs, recruiter contacts, execution logs, CSV export.
  - `chrome.storage.local`: user application profiles, target job whitelist, company blacklist, API keys.
- **Agent Interoperability:** Model Context Protocol (MCP) via `@modelcontextprotocol/sdk` on stdio, bridged to the Chrome Extension via `ws://127.0.0.1:8765`.

---

## 2. Using AutoApply AI via MCP (For Coding Agents)

When AutoApply AI is registered as an MCP server in your environment, you have direct programmatic control over the user's active browser job search session.

### Available MCP Tools

#### 1. `autoapply_status`
- **Description:** Checks extension connectivity, active tab platform, running queue state, and daily rate limit counts.
- **Usage:** Call this first to verify that Google Chrome is open and connected to the bridge.

#### 2. `autoapply_get_current_job`
- **Description:** Scrapes the job currently open in the active browser tab.
- **Returns:** `{ title, company, location, platform, jobDescription, extractedContacts, canEasyApply }`.

#### 3. `autoapply_apply_current_job`
- **Description:** Triggers the application workflow on the active tab.
- **Parameters:**
  - `mode` (`'semi-auto'` | `'full-auto'`):
    - `'semi-auto'` (Recommended): Fills all fields, generates cover letters/pitches, advances to the review step, and halts for user or agent approval.
    - `'full-auto'`: Directly completes submission.

#### 4. `autoapply_approve_pending`
- **Description:** Submits an application currently paused at the `'WAITING_APPROVAL'` review step.

#### 5. `autoapply_get_user_profile` & `autoapply_update_user_profile`
- **Description:** Read or update the candidate's active profile, contact info, experience, notice period, target roles whitelist, or company blacklist.

#### 6. `autoapply_list_applied_jobs`
- **Description:** Queries applied job history from IndexedDB, including recruiter emails and generated artifacts.

#### 7. `autoapply_queue_control`
- **Description:** Controls bulk queue navigation across search results (`start`, `pause`, `resume`, `stop`).

#### 8. `autoapply_search_and_apply`
- **Description:** Autonomously navigates to a job platform, initiates a search with Easy-Apply and Remote filters, iterates through search results card-by-card, checks candidate fit & blacklist, and applies automatically across multiple pages.
- **Parameters:**
  - `query` (`string`): Target job title or keywords (e.g. `"Full Stack Engineer"`, `"React Developer"`).
  - `location` (`string`, optional): Location filter (e.g. `"Remote"`, `"United States"`).
  - `platform` (`'linkedin'` | `'indeed'` | `'wellfound'` | `'naukri'`): Platform to search (default: `'linkedin'`).
  - `mode` (`'semi-auto'` | `'full-auto'`): Semi-auto halts before each final submit; full-auto completes directly.
  - `maxJobs` (`number`, default `10`): Application ceiling for this search session.
  - `remoteOnly` (`boolean`, default `false`): Restrict search results to remote roles.

---

## 3. Autonomous Agent Workflow Examples

### Example A: Single Tab Match & Apply
When a user asks: *"Check the job on my screen and apply if it matches my profile"*:
1. Call `autoapply_status` to ensure extension is connected.
2. Call `autoapply_get_current_job` to extract job details and requirements.
3. Call `autoapply_get_user_profile` to review candidate skills and target role filters.
4. Evaluate job match (compare required skills against resume markdown).
5. If match is strong: Call `autoapply_apply_current_job` with `mode: "semi-auto"`.
6. Inspect the returned step status. If `PENDING_APPROVAL`, summarize the filled application and ask the user (or call `autoapply_approve_pending`) to complete submission.

### Example B: Autonomous Search & Multi-Page Apply
When a user asks: *"Find remote React developer jobs on LinkedIn and apply to 5 matching roles"*:
1. Call `autoapply_search_and_apply` with:
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
2. The orchestrator automatically loads LinkedIn's search results with `f_AL=true` and `f_WT=2`, iterates through cards, deduplicates against previous applications in Dexie DB, fills forms, pauses for approval (if semi-auto), and paginates through search pages until 5 applications are completed.

---

## 4. Coding Conventions & Invariants

When modifying this repository, agents must adhere to the following strict invariants:

### A. DOM Automation Integrity
- **React/Controlled Forms:** Never use simple assignment (`element.value = val`). Always use `setNativeValue(element, val)` from `src/lib/dom-utils.ts`, which invokes `Object.getOwnPropertyDescriptor(prototype, 'value')?.set` and dispatches bubbling `input`, `change`, and `blur` events.
- **Human Latency Jitter:** Never dispatch instant 0ms interactions. Always introduce human-like micro-delays (50–120ms) using `randomDelay` and `simulateClick`.

### B. Storage Separation Invariant
- **Do NOT import `db.ts` (Dexie) in content scripts.**
- Chromium content scripts must only import lightweight `src/lib/storage.ts` (`chrome.storage.local`). Importing Dexie into content scripts causes Chromium UTF-8 noncharacter errors (`\uFFFF`).

### C. Chromium UTF-8 Sanitizer
- Always ensure the post-build sanitizer runs (`node scripts/sanitize-encoding.js` or via WXT `build:done` hook). This guarantees all emitted bundles are strictly compliant with Chromium's `base::IsStringUTF8` validator.

### D. Verification Commands
Before completing tasks or committing changes, always run:
```bash
npm run compile   # Runs tsc --noEmit (must pass with 0 errors)
npm run build     # Builds WXT MV3 bundle and runs encoding sanitizer
```
