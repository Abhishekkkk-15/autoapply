from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from job_agent.api.state import runner_state
from job_agent.config import JobPreferences, UserProfile
from job_agent.database import JobTracker
from job_agent.orchestrator import JobAgentOrchestrator
from job_agent.services.fast_search import FastSearchManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

tracker = JobTracker()
search_manager = FastSearchManager(tracker=tracker)


# Request schemas
class SearchRequest(BaseModel):
	roles: list[str] = Field(default_factory=lambda: ["AI Engineer", "Software Engineer"])
	locations: list[str] = Field(default_factory=lambda: ["Remote"])
	platforms: list[str] = Field(default_factory=lambda: ["all"])
	limit: int = 15
	min_fit_score: float = 40.0
	easy_apply_only: bool = False
	time_posted_days: int | None = 14


class StatusUpdateRequest(BaseModel):
	status: str
	notes: str | None = None
	pitch_used: str | None = None


class ApplyRequest(BaseModel):
	limit: int = 5
	dry_run: bool = True
	mode: str = "ask"


class AutoPipelineRequest(BaseModel):
	mode: str = "ask"
	dry_run: bool = False
	platforms: list[str] = Field(default_factory=lambda: ["all"])
	roles: list[str] = Field(default_factory=lambda: ["AI Engineer", "Software Engineer"])
	locations: list[str] = Field(default_factory=lambda: ["Remote"])
	min_fit_score: float = 45.0
	max_apply: int = 5


class InterviewLogRequest(BaseModel):
	job_id: int
	company_name: str
	role: str
	scheduled_at: str | None = None
	meeting_link: str | None = None
	notes: str | None = None


# Endpoints
@router.get("/stats")
def get_stats() -> dict[str, Any]:
	"""Get high-level funnel statistics and platform breakdown."""
	return tracker.get_stats()


@router.get("/jobs")
def get_jobs(
	response: Response,
	status: str | None = None,
	platform: str | None = None,
	search: str | None = None,
	limit: int = 50,
	offset: int = 0,
) -> list[dict[str, Any]]:
	"""Retrieve discovered jobs with optional status, platform, search, and pagination."""
	total = tracker.count_jobs(platform=platform, status=status, search=search)
	response.headers["X-Total-Count"] = str(total)
	response.headers["X-Limit"] = str(limit)
	response.headers["X-Offset"] = str(offset)
	return tracker.get_all_jobs(platform=platform, status=status, search=search, limit=limit, offset=offset)


@router.get("/jobs/paged")
def get_jobs_paged(
	status: str | None = None,
	platform: str | None = None,
	search: str | None = None,
	page: int = 1,
	page_size: int = 25,
) -> dict[str, Any]:
	"""Retrieve paginated jobs with total counts, total pages, and pagination metadata."""
	offset = max(0, (page - 1) * page_size)
	total = tracker.count_jobs(platform=platform, status=status, search=search)
	items = tracker.get_all_jobs(platform=platform, status=status, search=search, limit=page_size, offset=offset)
	total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1
	return {
		"items": items,
		"total": total,
		"page": page,
		"page_size": page_size,
		"total_pages": total_pages,
	}


@router.get("/jobs/{job_id}")
def get_job_detail(job_id: int) -> dict[str, Any]:
	"""Retrieve details for a single job."""
	job = tracker.get_job_by_id(job_id)
	if not job:
		raise HTTPException(status_code=404, detail="Job not found")
	return job


@router.patch("/jobs/{job_id}/status")
def update_job_status(job_id: int, payload: StatusUpdateRequest) -> dict[str, str]:
	"""Update the tracking status of a specific job."""
	job = tracker.get_job_by_id(job_id)
	if not job:
		raise HTTPException(status_code=404, detail="Job not found")
	tracker.update_status(
		job_url=job["job_url"],
		status=payload.status,
		notes=payload.notes,
		pitch_used=payload.pitch_used,
	)
	return {"status": "ok", "message": f"Updated job #{job_id} to {payload.status}"}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int) -> dict[str, str]:
	"""Delete a job record from the database."""
	deleted = tracker.delete_job(job_id)
	if not deleted:
		raise HTTPException(status_code=404, detail="Job not found")
	return {"status": "ok", "message": f"Deleted job #{job_id}"}


@router.post("/jobs/{job_id}/pitch")
async def generate_pitch(job_id: int) -> dict[str, str]:
	"""Generate an AI tailored cover letter pitch for this role."""
	job = tracker.get_job_by_id(job_id)
	if not job:
		raise HTTPException(status_code=404, detail="Job not found")
	user_profile = UserProfile.from_env_or_defaults()
	orchestrator = JobAgentOrchestrator(user_profile=user_profile)
	pitch = await orchestrator.application_agent.generate_pitch(job)
	return {"pitch": pitch}


@router.post("/search")
def run_search(payload: SearchRequest) -> dict[str, Any]:
	"""Execute high-speed multi-platform fast discovery across LinkedIn, RemoteOK, WWR, and ATS aggregators."""
	user = UserProfile.from_env_or_defaults()
	prefs = JobPreferences.from_env_or_defaults()
	prefs.target_roles = payload.roles
	prefs.target_locations = payload.locations
	prefs.min_fit_score = payload.min_fit_score

	runner_state.log(f"Searching for {', '.join(payload.roles)} on {', '.join(payload.platforms)}...")
	result = search_manager.execute_fast_search(
		user_profile=user,
		preferences=prefs,
		roles=payload.roles,
		locations=payload.locations,
		platforms=payload.platforms,
		limit_per_query=payload.limit,
		min_fit_score=payload.min_fit_score,
		easy_apply_only=payload.easy_apply_only,
		time_posted_days=payload.time_posted_days,
	)
	runner_state.log(f"Discovery complete: {result.get('total_scraped')} scraped, {result.get('saved_count')} qualified and saved.")
	return result


@router.get("/profile", response_model=UserProfile)
def get_user_profile() -> UserProfile:
	"""Fetch candidate profile."""
	return UserProfile.from_env_or_defaults()


@router.put("/profile")
def update_user_profile(payload: UserProfile) -> dict[str, str]:
	"""Save updated candidate profile to user_profile.json."""
	payload.save_to_file()
	runner_state.log("Candidate profile updated.")
	return {"status": "ok", "message": "Profile saved successfully"}


@router.get("/preferences", response_model=JobPreferences)
def get_job_preferences() -> JobPreferences:
	"""Fetch job search and autopilot preferences."""
	return JobPreferences.from_env_or_defaults()


@router.put("/preferences")
def update_job_preferences(payload: JobPreferences) -> dict[str, str]:
	"""Save updated job preferences to job_preferences.json."""
	payload.save_to_file()
	runner_state.log("Job preferences updated.")
	return {"status": "ok", "message": "Preferences saved successfully"}


@router.get("/interviews")
def get_interviews() -> list[dict[str, Any]]:
	"""List recorded interview invitations."""
	return tracker.get_interviews()


@router.post("/interviews")
def log_interview(payload: InterviewLogRequest) -> dict[str, Any]:
	"""Log a new scheduled interview."""
	interview_id = tracker.record_interview(
		job_id=payload.job_id,
		company_name=payload.company_name,
		role=payload.role,
		scheduled_at=payload.scheduled_at,
		meeting_link=payload.meeting_link,
		notes=payload.notes,
	)
	runner_state.log(f"Logged interview with {payload.company_name} for {payload.role}.")
	return {"status": "ok", "interview_id": interview_id}


@router.post("/clean")
def clean_database(min_fit: float = 40.0) -> dict[str, Any]:
	"""Purge unapplied vacancies scoring strictly below min_fit."""
	deleted = tracker.delete_jobs_below_fit_score(min_fit)
	runner_state.log(f"Cleaned {deleted} vacancies below {min_fit}% fit.")
	return {"status": "ok", "deleted_count": deleted}


# Background Runner Controls
@router.get("/runner/status")
def get_runner_status() -> dict[str, Any]:
	"""Get current execution state and real-time logs."""
	return runner_state.to_dict()


@router.post("/runner/apply")
def trigger_apply_run(payload: ApplyRequest) -> dict[str, Any]:
	"""Trigger browser form-filling run in background."""
	if runner_state.is_running:
		raise HTTPException(status_code=409, detail="A task is already running.")

	user = UserProfile.from_env_or_defaults()
	prefs = JobPreferences.from_env_or_defaults()
	prefs.dry_run = payload.dry_run
	prefs.mode = "free" if payload.mode == "free" else "ask"
	prefs.max_applications_per_run = payload.limit

	orchestrator = JobAgentOrchestrator(user_profile=user, preferences=prefs)
	started = runner_state.start_run(
		task_name=f"apply (limit={payload.limit}, dry_run={payload.dry_run})",
		coro=orchestrator.run_apply_only(limit=payload.limit),
	)
	return {"status": "started" if started else "busy", "task": runner_state.current_task}


@router.post("/runner/auto")
def trigger_auto_pipeline(payload: AutoPipelineRequest) -> dict[str, Any]:
	"""Trigger full 4-phase autonomous pipeline in background."""
	if runner_state.is_running:
		raise HTTPException(status_code=409, detail="A task is already running.")

	user = UserProfile.from_env_or_defaults()
	prefs = JobPreferences.from_env_or_defaults()
	prefs.mode = "free" if payload.mode == "free" else "ask"
	prefs.dry_run = payload.dry_run
	prefs.target_roles = payload.roles
	prefs.target_locations = payload.locations
	prefs.min_fit_score = payload.min_fit_score
	prefs.max_applications_per_run = payload.max_apply

	orchestrator = JobAgentOrchestrator(user_profile=user, preferences=prefs)
	started = runner_state.start_run(
		task_name=f"auto_pipeline (mode={payload.mode}, dry_run={payload.dry_run})",
		coro=orchestrator.run_autonomous_pipeline(
			mode=payload.mode,
			platforms=payload.platforms,
			max_applications=payload.max_apply,
			min_fit_score=payload.min_fit_score,
			dry_run=payload.dry_run,
		),
	)
	return {"status": "started" if started else "busy", "task": runner_state.current_task}


@router.post("/runner/stop")
def stop_runner() -> dict[str, Any]:
	"""Cancel active runner task."""
	cancelled = runner_state.cancel()
	return {"status": "cancelled" if cancelled else "not_running"}
