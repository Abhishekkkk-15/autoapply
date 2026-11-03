from __future__ import annotations

from unittest.mock import MagicMock, patch

from job_agent.config import JobPreferences, UserProfile
from job_agent.database import JobTracker
from job_agent.services.fast_search.deduplicator import (
	clean_company_name,
	clean_job_title,
	clean_job_url,
	compute_job_fingerprint,
)
from job_agent.services.fast_search.freehire_client import FreehireClient
from job_agent.services.fast_search.linkedin_guest import LinkedInGuestScraper
from job_agent.services.fast_search.manager import FastSearchManager
from job_agent.services.fast_search.models import DiscoveredJob
from job_agent.services.fast_search.remoteok_provider import RemoteOKProvider
from job_agent.services.fast_search.wwr_provider import WeWorkRemotelyProvider


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
	mock_rok = MagicMock(spec=RemoteOKProvider)
	mock_rok.search.return_value = []
	mock_wwr = MagicMock(spec=WeWorkRemotelyProvider)
	mock_wwr.search.return_value = []

	manager = FastSearchManager(
		tracker=tracker,
		linkedin_scraper=mock_li,
		freehire_client=mock_ats,
		remoteok_provider=mock_rok,
		wwr_provider=mock_wwr,
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


def test_deduplicator():
	url1 = "https://www.linkedin.com/jobs/view/12345678/?refId=abcdef&trackingId=9999"
	url2 = "https://www.linkedin.com/jobs/view/12345678"
	assert clean_job_url(url1) == clean_job_url(url2)

	comp1 = "Acme Technologies, Inc."
	comp2 = "Acme LLC"
	assert clean_company_name(comp1) == clean_company_name(comp2) == "acme"

	title1 = "Senior Backend Engineer (Remote) [Urgent]"
	title2 = "Senior Backend Engineer"
	assert clean_job_title(title1) == clean_job_title(title2) == "senior backend engineer"

	fp1 = compute_job_fingerprint("Vercel, Inc.", "Full Stack Engineer (Remote)")
	fp2 = compute_job_fingerprint("Vercel", "Full Stack Engineer")
	assert fp1 == fp2


def test_remoteok_provider_parsing():
	provider = RemoteOKProvider()
	mock_feed = [
		{"legal": "notice"},
		{
			"id": "888",
			"position": "Senior AI Infrastructure Engineer",
			"company": "Scale AI, Inc.",
			"url": "https://remoteok.com/remote-jobs/888",
			"apply_url": "https://boards.greenhouse.io/scaleai/jobs/888?gh_src=remoteok",
			"location": "Worldwide",
			"tags": ["ai", "python", "kubernetes"],
			"description": "<p>Build agent scaling infrastructure.</p>",
			"salary_min": 140000,
			"salary_max": 200000,
			"date": "2026-10-15",
		},
		{
			"id": "889",
			"position": "Sales Development Representative",
			"company": "ColdCo",
			"url": "https://remoteok.com/remote-jobs/889",
			"tags": ["sales", "outreach"],
			"description": "Cold calling",
		},
	]
	with patch.object(provider, "_fetch_all_jobs", return_value=mock_feed[1:]):
		jobs = provider.search(query="AI Engineer", limit=5)
		assert len(jobs) == 1
		job = jobs[0]
		assert job.job_title == "Senior AI Infrastructure Engineer"
		assert job.company_name == "Scale AI, Inc."
		assert job.platform == "remoteok"
		assert "140,000" in (job.salary_range or "")
		assert "ai" in job.required_skills
		assert not job.is_easy_apply


def test_wwr_provider_parsing():
	provider = WeWorkRemotelyProvider()
	mock_items = [
		{
			"title": "Stripe: Staff Backend Engineer",
			"link": "https://weworkremotely.com/remote-jobs/12345-staff-backend-engineer?ref=wwr",
			"description": "<p>Designing high-throughput payment systems with Go, Python, and PostgreSQL.</p>",
			"pubDate": "Wed, 04 Nov 2026 12:00:00 +0000",
		},
		{
			"title": "DesignAgency: Creative Art Director",
			"link": "https://weworkremotely.com/remote-jobs/99999-creative-art-director",
			"description": "Figma design",
			"pubDate": "Wed, 04 Nov 2026 11:00:00 +0000",
		},
	]
	with patch.object(provider, "_fetch_feed", return_value=mock_items):
		jobs = provider.search(query="Backend Engineer", limit=5)
		assert len(jobs) == 1
		job = jobs[0]
		assert job.company_name == "Stripe"
		assert job.job_title == "Staff Backend Engineer"
		assert job.platform == "weworkremotely"
		assert "Python" in job.required_skills or "Postgresql" in job.required_skills
		assert not job.is_easy_apply


def test_fast_search_manager_cross_platform_deduplication(tmp_path):
	db_path = tmp_path / "dedup_tracker.db"
	tracker = JobTracker(db_path=db_path)

	# Provider 1 (LinkedIn) returns a job
	mock_li = MagicMock(spec=LinkedInGuestScraper)
	mock_li.search.return_value = [
		DiscoveredJob(
			job_id="li-1",
			job_title="Software Engineer (Remote)",
			company_name="Vercel Inc.",
			job_url="https://www.linkedin.com/jobs/view/111?trackingId=abc",
			platform="linkedin",
			location="Remote",
			job_description_summary="Next.js and React",
		)
	]

	# Provider 2 (RemoteOK) returns the exact same job cross-posted with different URL
	mock_rok = MagicMock(spec=RemoteOKProvider)
	mock_rok.search.return_value = [
		DiscoveredJob(
			job_id="rok-2",
			job_title="Software Engineer",
			company_name="Vercel",
			job_url="https://remoteok.com/remote-jobs/222",
			platform="remoteok",
			location="Remote",
			job_description_summary="Next.js and React",
		)
	]

	mock_ats = MagicMock(spec=FreehireClient)
	mock_ats.search.return_value = []
	mock_wwr = MagicMock(spec=WeWorkRemotelyProvider)
	mock_wwr.search.return_value = []

	manager = FastSearchManager(
		tracker=tracker,
		linkedin_scraper=mock_li,
		freehire_client=mock_ats,
		remoteok_provider=mock_rok,
		wwr_provider=mock_wwr,
	)

	user = UserProfile(years_of_experience=2.0, current_role="Software Engineer")
	prefs = JobPreferences(target_roles=["Software Engineer"], min_fit_score=20.0)

	result = manager.execute_fast_search(user_profile=user, preferences=prefs)

	# Cross-platform duplicate should be collapsed into a single job
	assert result["total_scraped"] == 1
	assert result["saved_count"] == 1

