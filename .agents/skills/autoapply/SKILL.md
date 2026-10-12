---
name: autoapply
description: >-
  Autonomous recruitment intelligence and job application agent runbook. Use this skill
  when the user wants to search for jobs across LinkedIn, Wellfound, Naukri, or ATS portals,
  calculate experience fit, autofill application forms, extract recruiter contacts,
  draft cover letter pitches, send cold outreach via browser Gmail, or track applications and interviews.
---

# AutoApply: Autonomous AI Job Application Agent

AutoApply is a multi-platform job discovery, qualification, and autonomous application system powered by `browser-use` and Playwright.

This skill equips coding agents to configure, diagnose, search, evaluate, apply, and conduct recruiter outreach autonomously on behalf of the user.

---

## 1. Quick Verification & Diagnostics

Before executing job searches or applications, verify the environment and credentials.

### Check System Readiness
```bash
uv run autoapply doctor
```
Verify the diagnostic results:
- **Chromium / Chrome**: Status must be `PASS`.
- **LLM Connectivity**: Status must be `PASS` (latency displayed).
- **Candidate Profile**: Status must be `PASS`.
- **Resume**: Status should be `PASS` (place `resume.pdf` in `job_agent/data/resume.pdf` to attach to forms).
- **Saved Auth Session**: If `NOT SAVED`, prompt the user to log into job boards once using `uv run autoapply auth --platform all --manual`.

### Quick Configuration Check
```bash
uv run autoapply config check
```

---

## 2. Standard Workflows & Command Runbooks

### Workflow A: Zero-Token Fast Job Search (Recommended First Step)
Uses unauthenticated LinkedIn guest APIs and direct tech ATS aggregators (Greenhouse, Ashby, Lever) to scrape and score jobs in seconds without burning LLM tokens:

```bash
# Basic fast search (defaults to roles from user_profile.json):
uv run autoapply search --platforms linkedin,ats --limit 25 --min-fit 50

# Custom role & location search:
uv run autoapply search --roles "AI Engineer, Full Stack Developer" --location "Remote" --limit 50 --min-fit 60

# Deep browser search for login-gated portals (Wellfound, Naukri):
uv run autoapply search --browser --platforms wellfound,naukri
```

### Workflow B: Safe Application Form Filling (Dry-Run Preview)
Fills out multi-step forms on screen, attaches resume, and answers screening questions, stopping right before the final submission:

```bash
# Dry-run preview top 3 pending jobs:
uv run autoapply apply --dry-run --limit 3

# Live application submission (submits forms directly):
uv run autoapply apply --live --limit 5
```

### Workflow C: End-to-End Autonomous Pipeline (`auto`)
Executes the unified 4-phase recruitment lifecycle:
**Phase 1: Search** $\to$ **Phase 2: Recruiter Extraction** $\to$ **Phase 3: Best-Fit Applications** $\to$ **Phase 4: Cold Outreach**

```bash
# 1. Interactive Ask Mode (Pauses for human confirmation before each submit/email):
uv run autoapply auto --mode ask --dry-run

# 2. Interactive Live Mode:
uv run autoapply auto --mode ask

# 3. Full Autopilot Mode (100% autonomous, no terminal pauses):
uv run autoapply auto --mode free --max-apply 5

# 4. Filter by platform and minimum match score:
uv run autoapply auto --platforms wellfound,linkedin --roles "Applied AI Engineer" --min-fit 60 --mode ask
```

### Workflow D: Recruiter Intelligence & Cold Email Outreach
```bash
# Phase 2: Hunt for recruiter names, emails, and LinkedIn URLs for discovered jobs:
uv run autoapply extract --limit 10

# Phase 4: Dispatch cold emails via browser Gmail (Zero SMTP setup required):
uv run autoapply email --limit 5

# Generate tailored 3-4 sentence cover letter pitch for a specific job:
uv run autoapply pitch <job_id>
```

---

## 3. Database Inspection & Application Tracking

All discovered jobs, application statuses, recruiter contacts, and scheduled interviews are tracked locally in `job_agent/data/jobs_tracker.db`.

### View Campaign Progress
```bash
# View funnel statistics (found, applied, interviews, outreach):
uv run autoapply stats

# List discovered jobs:
uv run autoapply jobs --limit 20

# Filter jobs by platform:
uv run autoapply jobs --platform linkedin
uv run autoapply jobs --platform wellfound

# Show full details, required skills, and qualification notes for a specific job:
uv run autoapply job show <job_id>
```

### Manage Job Records
```bash
# Update job status manually:
uv run autoapply job update <job_id> --status applied   # Options: found, applied, interview, rejected, offer

# Delete an unwanted job record:
uv run autoapply job delete <job_id>

# Purge low-scoring jobs below threshold:
uv run autoapply clean --min-fit 45.0 -y

# Export all application records and HR contacts to CSV:
uv run autoapply export --output applications.csv
```

### Log and Track Interviews
```bash
# Log an interview invitation:
uv run autoapply interview log --job-id <id> --company "Acme Corp" --role "AI Engineer" --date "2026-10-20 14:00" --meeting-link "https://meet.google.com/xyz"

# List all scheduled interviews:
uv run autoapply interview list
```

---

## 4. Candidate Profile & Settings

Candidate details are stored locally in `job_agent/data/user_profile.json` and preferences in `job_agent/data/job_preferences.json`.

```bash
# Inspect active profile, calculated experience, and skills:
uv run autoapply profile show

# Re-run interactive setup wizard:
uv run autoapply setup

# Auto-parse a new resume into profile:
uv run autoapply setup --resume /path/to/new_resume.pdf --auto
```

---

## 5. Agent Safety & Guardrails

When executing tasks as an AI coding agent:
1. **Always default to `--dry-run` or `--mode ask`** unless the user explicitly commands a live submission or full autonomous run.
2. **Never expose or commit candidate resumes or `.env` files** to version control. The repository's `.gitignore` protects `job_agent/data/` and all `*.pdf`/`*resume*` files.
3. **Verify Chrome Profile lock hygiene**: If Chrome fails to start due to a profile lock collision, AutoApply automatically calls `clean_profile_locks()`, but you can also run `uv run autoapply doctor` to ensure the session is clean.
4. **Human-Paced Cooldowns**: Respect built-in randomized delays ($8 - 18\text{s}$) between platform actions to prevent rate-limiting or anti-bot flags.
