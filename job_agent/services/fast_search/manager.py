from __future__ import annotations

import logging
from typing import Any

from job_agent.config import JobPreferences, UserProfile
from job_agent.database import JobTracker
from job_agent.services.fast_search.freehire_client import FreehireClient
from job_agent.services.fast_search.linkedin_guest import LinkedInGuestScraper
from job_agent.services.fast_search.models import DiscoveredJob
from job_agent.services.fit_scorer import JobFitScorer

logger = logging.getLogger(__name__)


class FastSearchManager:
	"""Coordinates high-speed, zero-token job discovery across public endpoints.
	
	Runs candidate qualification and seniority hard gates in pure Python
	before storing qualified records in SQLite.
	"""

	def __init__(
		self,
		tracker: JobTracker | None = None,
		linkedin_scraper: LinkedInGuestScraper | None = None,
		freehire_client: FreehireClient | None = None,
	):
		self.tracker = tracker or JobTracker()
		self.linkedin_scraper = linkedin_scraper or LinkedInGuestScraper()
		self.freehire_client = freehire_client or FreehireClient()

	def execute_fast_search(
		self,
		user_profile: UserProfile,
		preferences: JobPreferences,
		roles: list[str] | None = None,
		locations: list[str] | None = None,
		platforms: list[str] | None = None,
		limit_per_query: int = 15,
		min_fit_score: float | None = None,
		hydrate_descriptions: bool = False,
	) -> dict[str, Any]:
		"""Execute multi-source fast discovery and qualification."""
		target_roles = roles or preferences.target_roles or [user_profile.current_role]
		target_locations = locations or preferences.target_locations or ["Remote"]
		min_score = min_fit_score if min_fit_score is not None else preferences.min_fit_score

		# Check if candidate is junior (<= 1.0 year) to automatically enable junior entry filter
		is_junior = float(user_profile.years_of_experience) <= 1.0

		selected_platforms = [p.lower() for p in (platforms or preferences.platforms)]
		include_linkedin = any("linkedin" in p for p in selected_platforms) or not selected_platforms
		include_ats = any(p in ("ats", "freehire", "all") for p in selected_platforms)

		raw_discovered: list[DiscoveredJob] = []
		seen_urls: set[str] = set()

		logger.info(f"⚡ Fast-Search starting across {len(target_roles)} roles and {len(target_locations)} locations...")

		# 1. Gather raw vacancies from fast providers
		for role in target_roles:
			for loc in target_locations:
				# LinkedIn Guest API
				if include_linkedin:
					try:
						li_jobs = self.linkedin_scraper.search(
							query=role,
							location=loc,
							remote_mode="remote" if "remote" in loc.lower() else None,
							junior_filter=is_junior,
							limit=limit_per_query,
							hydrate_details=hydrate_descriptions,
						)
						for j in li_jobs:
							if j.job_url not in seen_urls:
								seen_urls.add(j.job_url)
								raw_discovered.append(j)
					except Exception as ex:
						logger.warning(f"Error during LinkedIn fast search for '{role}': {ex}")

				# Freehire / Open ATS Aggregator
				if include_ats or (not include_linkedin and not selected_platforms):
					try:
						ats_jobs = self.freehire_client.search(
							query=role,
							limit=limit_per_query,
							work_mode="remote" if "remote" in loc.lower() else None,
							skills=user_profile.skills[:5],
						)
						for j in ats_jobs:
							if j.job_url not in seen_urls:
								seen_urls.add(j.job_url)
								raw_discovered.append(j)
					except Exception as ex:
						logger.debug(f"Error during ATS fast search for '{role}': {ex}")

		logger.info(f"Discovered {len(raw_discovered)} raw vacancies. Running candidate qualification gates...")

		# 2. Score and qualify every vacancy
		qualified_jobs: list[DiscoveredJob] = []
		saved_count = 0

		for job in raw_discovered:
			job_dict = job.to_db_dict()
			fit_result = JobFitScorer.score_fit(
				job=job_dict,
				user=user_profile,
				target_roles=target_roles,
				target_locations=target_locations,
			)

			job.match_score = round(fit_result.score, 1)
			job.notes = fit_result.reasoning

			# Disqualify if score falls below required threshold
			if job.match_score < min_score:
				continue

			qualified_jobs.append(job)

			# Save qualified vacancy to SQLite database
			try:
				job_record = job.to_db_dict()
				job_record["match_score"] = job.match_score
				job_record["notes"] = job.notes
				self.tracker.add_job(job_record)
				saved_count += 1
			except Exception as ex:
				logger.error(f"Failed to persist job '{job.job_title}' to tracker: {ex}")

		# Sort qualified vacancies by highest match score
		qualified_jobs.sort(key=lambda j: j.match_score, reverse=True)

		return {
			"total_scraped": len(raw_discovered),
			"qualified_count": len(qualified_jobs),
			"saved_count": saved_count,
			"jobs": qualified_jobs,
		}
