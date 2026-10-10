from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch

from job_agent.config import JobPreferences, UserProfile
from job_agent.database import JobTracker
from job_agent.services.fast_search.linkedin_guest import LinkedInGuestScraper
from job_agent.services.fast_search.freehire_client import FreehireClient
from job_agent.services.fast_search.manager import FastSearchManager
from job_agent.services.fast_search.models import DiscoveredJob


def test_discovered_job_model_conversion():
	job = DiscoveredJob(
		job_id="12345",
		job_title="AI Engineer",
		company_name="DeepMind",
		job_url="https://www.linkedin.com/jobs/view/12345",
		platform="linkedin",
		location="Remote",
		job_description_summary="Building autonomous agents",
		required_skills=["Python", "PyTorch"],
		match_score=85.0,
		notes="Strong skills match",
	)
	db_dict = job.to_db_dict()
	assert db_dict["job_title"] == "AI Engineer"
	assert db_dict["company_name"] == "DeepMind"
	assert db_dict["job_url"] == "https://www.linkedin.com/jobs/view/12345"
	assert db_dict["platform"] == "linkedin"
	assert db_dict["match_score"] == 85.0
	assert db_dict["status"] == "found"


def test_linkedin_guest_url_builder():
	scraper = LinkedInGuestScraper()
	url = scraper.build_search_url(
		query="Python Developer",
		location="Remote",
		remote_mode="remote",
		junior_filter=True,
		time_posted_days=1,
		start=10,
	)
	assert "keywords=Python+Developer" in url
	assert "f_WT=2" in url  # Remote
	assert "f_E=1%2C2" in url or "f_E=1,2" in url  # Junior/Intern
	assert "f_TPR=r86400" in url  # 24 hours
	assert "start=10" in url


def test_linkedin_guest_card_parsing():
	scraper = LinkedInGuestScraper()
	sample_html = """
	<ul class="jobs-search__results-list">
		<li>
			<div data-entity-urn="urn:li:jobPosting:987654321">
				<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/987654321?refId=xyz">
					<h3 class="base-search-card__title">Senior Python Architect</h3>
				</a>
				<h4 class="base-search-card__subtitle">Anthropic</h4>
				<span class="job-search-card__location">San Francisco, CA</span>
				<time datetime="2026-10-09">1 day ago</time>
			</div>
		</li>
		<li>
			<div data-entity-urn="urn:li:jobPosting:112233445">
				<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/112233445">
					<h3 class="base-search-card__title">Junior Full Stack Developer</h3>
				</a>
				<h4 class="base-search-card__subtitle">Startup Inc</h4>
				<span class="job-search-card__location">Remote</span>
				<time datetime="2026-10-10">Just now</time>
			</div>
		</li>
	</ul>
	"""
	cards = scraper.parse_job_cards(sample_html, is_remote_query=True)
	assert len(cards) == 2
	assert cards[0].job_id == "987654321"
	assert cards[0].job_title == "Senior Python Architect"
	assert cards[0].company_name == "Anthropic"
	assert "Remote" in cards[0].location  # Annotated because is_remote_query is True
	assert cards[0].job_url == "https://www.linkedin.com/jobs/view/987654321"

	assert cards[1].job_id == "112233445"
	assert cards[1].job_title == "Junior Full Stack Developer"
	assert cards[1].company_name == "Startup Inc"


def test_freehire_client_parsing():
	client = FreehireClient()
	mock_data = {
		"data": [
			{
				"external_id": "gh-999",
				"title": "Backend Engineer",
				"company": "Vercel",
				"url": "https://boards.greenhouse.io/vercel/jobs/999",
				"location": "Remote",
				"description": "FastAPI and Next.js backend infrastructure",
				"skills": ["python", "fastapi", "typescript"],
				"posted_at": "2026-10-08",
			}
		]
	}

	with patch("urllib.request.urlopen") as mock_urlopen:
		mock_resp = MagicMock()
		mock_resp.status = 200
		mock_resp.read.return_value = bytes(
			"""
			{"data": [{"external_id": "gh-999", "title": "Backend Engineer", "company": "Vercel", "url": "https://boards.greenhouse.io/vercel/jobs/999", "location": "Remote", "description": "FastAPI infrastructure", "skills": ["python", "fastapi"]}]}
			""",
			"utf-8"
		)
		mock_urlopen.return_value.__enter__.return_value = mock_resp

		jobs = client.search(query="Backend Engineer", limit=5)
		assert len(jobs) == 1
		assert jobs[0].job_title == "Backend Engineer"
		assert jobs[0].company_name == "Vercel"
		assert jobs[0].platform == "ats_aggregator"
		assert "python" in jobs[0].required_skills


def test_fast_search_manager_qualification_flow(tmp_path):
	db_path = tmp_path / "test_tracker.db"
	tracker = JobTracker(db_path=db_path)

	# Mock scrapers to return controlled sample jobs
	mock_li = MagicMock(spec=LinkedInGuestScraper)
	mock_li.search.return_value = [
		DiscoveredJob(
			job_id="101",
			job_title="Full Stack Software Engineer",
			company_name="TechCorp",
			job_url="https://www.linkedin.com/jobs/view/101",
			platform="linkedin",
			location="Remote",
			job_description_summary="Python and React engineering",
			required_skills=["Python", "React"],
		),
		DiscoveredJob(
			job_id="102",
			job_title="Senior Principal Director of AI",  # Should be rejected by hard seniority gate for junior
			company_name="MegaCorp",
			job_url="https://www.linkedin.com/jobs/view/102",
			platform="linkedin",
			location="Remote",
			job_description_summary="Leading 50+ staff engineers",
			required_skills=["Python"],
		),
	]

	mock_ats = MagicMock(spec=FreehireClient)
	mock_ats.search.return_value = []

	manager = FastSearchManager(
		tracker=tracker,
		linkedin_scraper=mock_li,
		freehire_client=mock_ats,
	)

	user = UserProfile(
		years_of_experience=0.8,
		current_role="Software Engineer",
		skills=["Python", "React", "TypeScript"],
	)
	prefs = JobPreferences(
		target_roles=["Software Engineer"],
		target_locations=["Remote"],
		min_fit_score=35.0,
	)

	result = manager.execute_fast_search(user_profile=user, preferences=prefs, limit_per_query=5)

	# 2 jobs were scraped, but Senior Principal Director should be rejected
	assert result["total_scraped"] == 2
	assert result["qualified_count"] == 1
	assert result["saved_count"] == 1

	saved_job = result["jobs"][0]
	assert saved_job.job_title == "Full Stack Software Engineer"
	assert saved_job.match_score >= 35.0

	# Verify it was inserted into JobTracker
	pending = tracker.get_pending_jobs()
	assert len(pending) == 1
	assert pending[0]["job_title"] == "Full Stack Software Engineer"
