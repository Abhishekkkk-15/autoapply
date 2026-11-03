from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from job_agent.api.app import app
from job_agent.config import JobPreferences, UserProfile
from job_agent.database import JobTracker


@pytest.fixture
def mock_tracker(tmp_path: Path):
	db_file = tmp_path / "test_api_tracker.db"
	tracker = JobTracker(db_file)
	# Insert sample jobs
	tracker.add_job({
		"job_title": "AI Engineer",
		"company_name": "DeepMind",
		"job_url": "https://example.com/job/1",
		"platform": "linkedin",
		"location": "Remote",
		"match_score": 90.0,
		"salary_range": "$150,000 - $180,000",
	})
	tracker.add_job({
		"job_title": "Backend Developer",
		"company_name": "Acme Corp",
		"job_url": "https://example.com/job/2",
		"platform": "weworkremotely",
		"location": "Remote",
		"match_score": 75.0,
	})
	return tracker


@pytest.fixture
def client(mock_tracker: JobTracker):
	with patch("job_agent.api.routes.tracker", mock_tracker), TestClient(app) as test_client:
		yield test_client


def test_serve_dashboard_html(client: TestClient):
	response = client.get("/")
	assert response.status_code == 200
	assert "AutoApply" in response.text
	assert "text/html" in response.headers.get("content-type", "")


def test_get_stats(client: TestClient):
	response = client.get("/api/stats")
	assert response.status_code == 200
	data = response.json()
	assert data["total_found"] == 2
	assert data["total_applied"] == 0
	assert len(data["platform_breakdown"]) >= 2


def test_get_jobs_and_filter(client: TestClient):
	# All jobs
	response = client.get("/api/jobs")
	assert response.status_code == 200
	jobs = response.json()
	assert len(jobs) == 2

	# Platform filter
	response_li = client.get("/api/jobs?platform=linkedin")
	assert response_li.status_code == 200
	li_jobs = response_li.json()
	assert len(li_jobs) == 1
	assert li_jobs[0]["company_name"] == "DeepMind"

	# Status filter
	response_applied = client.get("/api/jobs?status=applied")
	assert response_applied.status_code == 200
	assert len(response_applied.json()) == 0


def test_job_detail_and_status_update(client: TestClient):
	jobs = client.get("/api/jobs").json()
	job_id = jobs[0]["id"]

	# Get detail
	response_detail = client.get(f"/api/jobs/{job_id}")
	assert response_detail.status_code == 200
	assert response_detail.json()["id"] == job_id

	# Update status
	response_patch = client.patch(
		f"/api/jobs/{job_id}/status",
		json={"status": "applied", "notes": "Submitted via browser", "pitch_used": "Strong fit pitch"},
	)
	assert response_patch.status_code == 200
	assert response_patch.json()["status"] == "ok"

	# Verify update
	updated_job = client.get(f"/api/jobs/{job_id}").json()
	assert updated_job["status"] == "applied"
	assert updated_job["notes"] == "Submitted via browser"


def test_job_not_found(client: TestClient):
	response = client.get("/api/jobs/99999")
	assert response.status_code == 404

	patch_res = client.patch("/api/jobs/99999/status", json={"status": "applied"})
	assert patch_res.status_code == 404


def test_delete_job(client: TestClient):
	jobs = client.get("/api/jobs").json()
	job_id = jobs[0]["id"]

	delete_res = client.delete(f"/api/jobs/{job_id}")
	assert delete_res.status_code == 200

	# Ensure it is gone
	get_res = client.get(f"/api/jobs/{job_id}")
	assert get_res.status_code == 404


def test_runner_status_and_stop(client: TestClient):
	status_res = client.get("/api/runner/status")
	assert status_res.status_code == 200
	status_data = status_res.json()
	assert "is_running" in status_data
	assert "recent_logs" in status_data

	stop_res = client.post("/api/runner/stop")
	assert stop_res.status_code == 200
	assert stop_res.json()["status"] in ["cancelled", "not_running"]


def test_interviews_lifecycle(client: TestClient):
	jobs = client.get("/api/jobs").json()
	job_id = jobs[0]["id"]

	# Log interview
	log_res = client.post(
		"/api/interviews",
		json={
			"job_id": job_id,
			"company_name": "DeepMind",
			"role": "AI Engineer",
			"scheduled_at": "2026-11-10T15:00:00",
			"meeting_link": "https://meet.google.com/abc-defg-hij",
			"notes": "Technical screen with engineering manager",
		},
	)
	assert log_res.status_code == 200
	assert log_res.json()["status"] == "ok"

	# Retrieve interviews
	list_res = client.get("/api/interviews")
	assert list_res.status_code == 200
	interviews = list_res.json()
	assert len(interviews) == 1
	assert interviews[0]["company_name"] == "DeepMind"
	assert interviews[0]["meeting_link"] == "https://meet.google.com/abc-defg-hij"


def test_clean_database(client: TestClient):
	clean_res = client.post("/api/clean?min_fit=80.0")
	assert clean_res.status_code == 200
	# One job was 75.0 fit, so it should be cleaned
	data = clean_res.json()
	assert data["status"] == "ok"
	assert data["deleted_count"] == 1

	remaining = client.get("/api/jobs").json()
	assert len(remaining) == 1
	assert remaining[0]["company_name"] == "DeepMind"


def test_search_endpoint(client: TestClient):
	mock_search_result = {
		"total_scraped": 10,
		"saved_count": 5,
		"skipped_duplicates": 2,
		"disqualified_count": 3,
		"jobs": [],
	}

	with patch("job_agent.api.routes.search_manager.execute_fast_search", return_value=mock_search_result):
		search_res = client.post(
			"/api/search",
			json={
				"roles": ["AI Engineer"],
				"locations": ["Remote"],
				"platforms": ["remoteok", "wwr"],
				"limit": 10,
				"min_fit_score": 50.0,
				"easy_apply_only": False,
			},
		)
		assert search_res.status_code == 200
		data = search_res.json()
		assert data["total_scraped"] == 10
		assert data["saved_count"] == 5


def test_profile_and_preferences_endpoints(client: TestClient, tmp_path: Path):
	sample_profile = UserProfile(
		name="Test User",
		email="test@example.com",
		phone="+123456789",
		location="Remote",
		skills=["Python", "FastAPI"],
		years_of_experience=3.0,
		current_role="Software Engineer",
	)
	sample_prefs = JobPreferences(
		target_roles=["Software Engineer"],
		target_locations=["Remote"],
	)

	with patch("job_agent.api.routes.UserProfile.from_env_or_defaults", return_value=sample_profile), \
		patch("job_agent.config.UserProfile.save_to_file", return_value=tmp_path / "user_profile.json"):
		prof_res = client.get("/api/profile")
		assert prof_res.status_code == 200
		assert prof_res.json()["name"] == "Test User"

		update_res = client.put("/api/profile", json=sample_profile.model_dump(mode="json"))
		assert update_res.status_code == 200
		assert update_res.json()["status"] == "ok"

	with patch("job_agent.api.routes.JobPreferences.from_env_or_defaults", return_value=sample_prefs), \
		patch("job_agent.config.JobPreferences.save_to_file", return_value=tmp_path / "job_preferences.json"):
		pref_res = client.get("/api/preferences")
		assert pref_res.status_code == 200
		assert pref_res.json()["target_roles"] == ["Software Engineer"]

		update_pref_res = client.put("/api/preferences", json=sample_prefs.model_dump(mode="json"))
		assert update_pref_res.status_code == 200
		assert update_pref_res.json()["status"] == "ok"
