# CONTENT.md: Launch, Marketing & Distribution Kit

This document provides ready-to-use launch copy, social media announcement threads, technical community posts, demo video scripts, and marketing assets for **AutoApply**.

---

## 1. Product Positioning & Elevator Pitch

- **Tagline**: The autonomous AI recruitment intelligence and job application agent powered by `browser-use`.
- **One-Sentence Pitch**: AutoApply discovers high-match engineering roles across LinkedIn, RemoteOK, WeWorkRemotely, and ATS portals in seconds, enforces strict experience hard gates, autofills multi-step application forms with your resume, and coordinates cold recruiter outreach directly from your browser.
- **The Core Problem**: Job seekers spend 15–20 hours a week manually copying and pasting resumes into repetitive application forms, guessing answers to screening questions, and sending manual emails—only to get ghosted. Existing bot scripts blindly spam 500 applications a day, get banned, or apply to Senior/Staff roles candidates are unqualified for.
- **The Solution**: An intelligent, privacy-first local agent that runs on your real browser session, strictly enforces qualification gates, discovers jobs via zero-token concurrent APIs in 2 seconds, and gives you full control with interactive human-confirmation modes (`Ask` vs `Free` vs `--dry-run`).

---

## 2. Social Media Launch Assets

### A. Twitter / X Launch Thread

```markdown
🧵 1/6: Job hunting in tech is officially broken.
You spend 20 hours a week copying and pasting the exact same resume into 40 different Workday and Greenhouse portals.

So I built AutoApply: An open-source, autonomous AI recruitment agent powered by @browser_use.

Here is how it works 👇

2/6: ⚡ Zero-Token, Sub-3-Second Discovery
Most job bots burn millions of LLM tokens just browsing feeds.
AutoApply uses parallel unauthenticated APIs across LinkedIn, RemoteOK, WeWorkRemotely, and 50+ ATS aggregators.
It ingests, deduplicates, and scores 50+ vacancies in ~2.5 seconds with 0 LLM tokens burned.

3/6: 🛡️ Strict Experience & Seniority Hard Gates
Nobody wants a bot that applies to Principal or Staff roles with 1 year of experience.
AutoApply parses your resume and enforces strict Python hard gates:
• Candidate ≤ 1 yr exp? Roles requiring 2+ yrs are forced to 0.0% fit.
• Senior/Staff/Lead roles are auto-rejected for junior candidates.

4/6: 📝 Smart Multi-Step Easy Apply
Using Playwright & browser-use, AutoApply:
• Detects Easy Apply vs direct ATS forms
• Attaches your local resume.pdf
• Solves screening questions from your local profile
• Generates custom 3-sentence cover letter pitches
• Supports --dry-run so you can verify on-screen before submitting!

5/6: ✉️ Stealth Webmail Recruiter Outreach (Zero SMTP)
No third-party email APIs or app passwords required.
AutoApply extracts hiring manager names & emails from postings, opens Gmail in your existing Chrome session, drafts a tailored pitch, and prepares the draft for you to review or dispatch.

6/6: 🔒 100% Local & Privacy-First
Your credentials, resume, and profile NEVER touch a third-party server or .env file.
It attaches directly to your local Chrome profile and tracks everything in local SQLite.

Check out the repo (it's 100% open source):
⭐ GitHub: https://github.com/Abhishekkkk-15/autoapply
```

---

### B. LinkedIn Announcement Post

```markdown
🚀 Excited to open-source AutoApply: An Autonomous AI Job Discovery & Application Agent built on browser-use and Python.

Job applications have become an exhausting numbers game of repetitive form filling, screening questionnaires, and manual recruiter tracking.

I wanted to build an agent that acts like a senior recruitment assistant working strictly for YOU:

🔹 Multi-Platform Concurrent Search: Queries LinkedIn Guest endpoints, RemoteOK, WeWorkRemotely, and direct ATS aggregators simultaneously in under 3 seconds—burning zero LLM tokens for discovery.
🔹 Strict Qualification Hard Gates: Prevents spam applications. Roles requiring 2+ years are automatically gated if the candidate has junior experience, and Senior/Staff titles are filtered out.
🔹 Autonomous Form Solver: Operates your genuine Chrome browser session, navigates multi-step Easy Apply flows, attaches your PDF resume, and generates tailored pitches.
🔹 Stealth Recruiter Outreach: Discovers hiring manager emails and drafts personalized outreach directly inside your authenticated Gmail web session—zero SMTP passwords needed.
🔹 Safety & Autopilot Modes: Run in safe `--dry-run` to inspect forms on-screen, `--mode ask` to confirm every submission with an interactive terminal prompt, or `--mode free` for full autopilot.

Everything runs locally, preserving your candidate privacy with local JSON storage and SQLite tracking.

Check out the code, run the 1-command installer, and let me know your thoughts:
🔗 GitHub Repository: https://github.com/Abhishekkkk-15/autoapply

#ArtificialIntelligence #Python #OpenSource #AIagents #Automation #JobSearch #WebAutomation #Playwright
```

---

### C. Reddit Post (`r/Python`, `r/selfhosted`, `r/cscareerquestions`)

**Title**: *I built AutoApply: An open-source, local multi-platform AI job search & application agent (Python + browser-use)*

```markdown
Hey everyone,

Like many developers, I got tired of the repetitive grind of tech job applications: typing the same work history into 30 different portals, answering the same diversity and authorization questions, and tracking everything across spreadsheets.

Most existing "auto-apply" tools either cost $50/month, blindly spam 1,000 irrelevant senior roles you aren't qualified for, or require handing over your LinkedIn password to a remote server.

I built **AutoApply** as a 100% local, open-source alternative.

### How It Works:
1. **Parallel Zero-Token Discovery**: Ingests jobs from LinkedIn Guest endpoints, RemoteOK, WeWorkRemotely, and direct tech ATS portals (Greenhouse, Lever, Ashby) in parallel in ~2.5 seconds using pure Python HTTP clients.
2. **Hard Qualification Gates**: Enforces strict mathematical experience checks before saving. If a junior candidate (<=1 yr) encounters a role requiring 2+ years, the score drops to 0.0% immediately.
3. **Persistent Chrome Sessions**: Reuses your local Chrome profile directory (`CHROME_USER_DATA_DIR`). This means it bypasses 2FA, Captchas, and Cloudflare without ever exposing your passwords to `.env` or LLM context.
4. **Autonomous Form Solver**: Powered by `browser-use` and Playwright, it navigates multi-step forms, attaches your `resume.pdf`, answers questions from your local profile, and prepares the review screen.
5. **Interactive Ask vs Free Mode**:
   - `--mode ask` (Default): Pauses at the final submission button and displays a Rich terminal summary asking `[Y/n/edit]`.
   - `--dry-run`: Previews every field on screen, stopping right before submit.
   - `--mode free`: 100% autonomous background autopilot.
6. **Browser Webmail Outreach**: Hunts hiring manager emails and drafts tailored pitches directly in `mail.google.com`.

### Quickstart:
```bash
# Clone and run setup wizard
git clone https://github.com/Abhishekkkk-15/autoapply.git
cd autoapply
uv sync
uv run autoapply setup

# Search jobs across all platforms concurrently
uv run autoapply search --platforms all --roles "AI Engineer, Backend Developer" --limit 20

# Test form filling safely in dry-run mode
uv run autoapply apply --dry-run --limit 3
```

- **Source Code**: https://github.com/Abhishekkkk-15/autoapply
- **Tech Stack**: Python 3.11+, browser-use, Playwright, Click, Rich, Pydantic v2, SQLite.

Feedback, PRs, and feature requests are very welcome!
```

---

### D. Hacker News (Show HN)

**Title**: *Show HN: AutoApply – Local autonomous AI job search and application agent*

```markdown
Hey HN,

AutoApply is an open-source Python tool that automates tech job discovery, experience qualification, and form submission using browser-use and Playwright.

Repository: https://github.com/Abhishekkkk-15/autoapply

### Why I built this:
Most job application automations fall into two traps:
1. They burn heavy LLM tokens scraping web pages that could be fetched via public endpoints.
2. They blindly apply to every posting containing a keyword, spamming hiring managers with irrelevant applications (e.g. junior candidates applying to Principal Engineer roles).

### Architecture Highlights:
- **Fast-Path Discovery Engine**: Concurrently queries unauthenticated LinkedIn guest endpoints, RemoteOK, WeWorkRemotely, and open ATS aggregators in ~2.5s via ThreadPoolExecutor. Discloses compensation, deduplicates cross-postings by canonical company/title fingerprinting, and burns 0 LLM tokens for search.
- **Qualification Hard Gates**: Enforces strict experience gates in pure Python. Roles requiring 2+ years are rejected (0.0% score) if candidate has <= 1 year exp; Senior/Staff/Lead titles are filtered out for junior developers.
- **Zero-Credential Leaks**: Reuses the user's existing Chrome profile (`~/.config/browseruse/profiles/job_agent` or local Chrome user-data-dir). Passwords and session cookies are never exposed to LLMs or `.env`.
- **Human-in-the-Loop Safeguards**: Supports `--dry-run` and interactive `--mode ask`, displaying terminal previews before any final application submit or email dispatch.

The code is MIT licensed: https://github.com/Abhishekkkk-15/autoapply
```

---

## 3. Product Hunt / Directory Listing Copy

- **Name**: AutoApply
- **Tagline**: Autonomous AI recruitment intelligence & job application agent
- **Topics**: Artificial Intelligence, Developer Tools, Open Source, Productivity, Careers
- **Short Description**: AutoApply discovers high-match tech jobs across LinkedIn, RemoteOK, and ATS portals in seconds, enforces strict experience hard gates, and autofills applications via real Chrome sessions.

**Maker's First Comment**:
```markdown
Hey Product Hunt! 👋

Job hunting in tech has become an exhausting full-time job in itself. You spend hours re-typing your resume into ATS forms, filtering through ghost jobs, and trying to reach hiring managers.

I built AutoApply to bring autonomy, accuracy, and safety to the job hunt:

⚡ Parallel Fast Search: Ingests vacancies from LinkedIn, RemoteOK, WeWorkRemotely, and ATS aggregators in under 3 seconds with zero LLM token waste.
🛡️ Hard Seniority Gates: Automatically rejects roles where there's an experience mismatch so you never spam hiring managers.
🤖 Smart Form Solver: Connects to your genuine Chrome browser session to complete multi-step applications and attach your resume.
🔒 100% Local: No third-party servers. Your profile, resume, and tracker database remain on your machine.

I'd love to hear your feedback and ideas for new platform integrations!
```

---

## 4. 60-Second Video / Demo Script

| Timestamp | Visual on Screen | Voiceover / Audio |
| :--- | :--- | :--- |
| **0:00 - 0:10** | Terminal showing `uv run autoapply search --platforms all --roles "AI Engineer"` | *"Tired of spending hours filling out the same repetitive job forms? Meet AutoApply."* |
| **0:10 - 0:25** | Rich terminal table instantly displays 20+ jobs from LinkedIn, RemoteOK, and WWR with salaries and fit scores | *"In under 3 seconds, AutoApply queries multiple job boards in parallel, extracts salaries, and scores each posting against your resume using strict experience hard gates."* |
| **0:25 - 0:42** | Chrome browser window opens with `autoapply apply --dry-run`, navigating LinkedIn Easy Apply, uploading resume, answering questions | *"Watch it navigate multi-step forms on-screen, attach your resume, and solve screening questions—all using your real browser session with zero credential leaks."* |
| **0:42 - 0:52** | Terminal pauses with Rich confirmation panel: `[Y/n/edit] Ready to submit?` | *"With interactive Ask Mode, you stay in complete control: review the answers before clicking submit, or let it run on full autopilot."* |
| **0:52 - 1:00** | GitHub repo page with star button | *"AutoApply is 100% free and open-source. Clone the repo and automate your job hunt today."* |

---

## 5. SEO, GitHub Metadata & Topics

- **GitHub Repository Description**:
  `Autonomous AI recruitment intelligence and job application agent powered by browser-use and Playwright.`
- **Recommended GitHub Topics / Tags**:
  `ai-agent`, `job-application-automation`, `browser-use`, `playwright`, `linkedin-easy-apply`, `remote-jobs`, `fast-search`, `career-tools`, `python`, `recruitment-intelligence`, `automation`
