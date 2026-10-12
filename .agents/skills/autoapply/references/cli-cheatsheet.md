# AutoApply CLI Quick Reference Cheatsheet

| Command | Key Arguments & Flags | Description |
| :--- | :--- | :--- |
| `doctor` | *(None)* | Diagnose Chrome, LLM connectivity, resume, database, and auth cookies |
| `setup` | `--resume <path>`, `--auto`, `--clean` | Interactive onboarding wizard; parses resume and saves profile |
| `auth` / `login` | `--platform <name>`, `--manual`, `--email`, `--password` | Opens headful Chrome to log in and persist cookies |
| `search` | `--platforms <list>`, `--roles "..."`, `--location "..."`, `--limit <N>`, `--min-fit <score>`, `--fast/--browser` | Discovers vacancies matching candidate profile |
| `apply` | `--dry-run/--live`, `--limit <N>` | Autofills Easy Apply forms for pending cataloged jobs |
| `extract` | `--limit <N>` | Scrapes recruiter names, emails, and LinkedIn links |
| `email` | `--limit <N>` | Dispatches tailored cold emails via browser webmail (Gmail) |
| `auto` | `--mode ask/free`, `--dry-run/--live`, `--platforms <list>`, `--roles "..."`, `--min-fit <score>`, `--max-apply <N>` | Unified 4-phase autonomous recruitment pipeline |
| `jobs` | `--limit <N>`, `--platform <name>` | Formatted table listing of cataloged jobs |
| `job show` | `<job_id>` | Detailed inspection of a job record, stack, and notes |
| `job update` | `<job_id> --status <status> [--notes "..."]` | Updates status (`found`, `applied`, `interview`, `rejected`, `offer`) |
| `job delete` | `<job_id>` | Deletes a job record from the database |
| `clean` | `--min-fit <score> [--yes]` | Purges unapplied jobs scoring below threshold |
| `reset-db` | `[--yes]` | Completely resets the database schema to empty |
| `stats` | *(None)* | Dashboard displaying campaign metrics and platform breakdowns |
| `pitch` | `<job_id>` | Generates custom tailored cover letter pitch |
| `interview log` | `--job-id <id> --company "..." --role "..." [--date "..."] [--meeting-link "..."]` | Records an interview invitation |
| `interview list` | *(None)* | Lists all scheduled interviews |
| `export` | `[--output <path.csv>]` | Exports all tracked applications to CSV |
| `profile show` | *(None)* | Displays active candidate profile and skills |
| `config check` | *(None)* | Quick health check on environment variables and database |
| `interactive` | `[--url "..."] [--task "..."]` | Launches headful Chrome with interactive in-browser REPL |
