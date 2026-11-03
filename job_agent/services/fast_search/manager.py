from __future__ import annotations

import concurrent.futures
import logging
from typing import Any

from job_agent.config import JobPreferences, UserProfile
from job_agent.database import JobTracker
from job_agent.services.fast_search.deduplicator import (
	clean_job_url,
	compute_job_fingerprint,
	extract_salary_from_text,
)
from job_agent.services.fast_search.freehire_client import FreehireClient
from job_agent.services.fast_search.linkedin_guest import LinkedInGuestScraper
from job_agent.services.fast_search.models import DiscoveredJob
from job_agent.services.fast_search.remoteok_provider import RemoteOKProvider
from job_agent.services.fast_search.wwr_provider import WeWorkRemotelyProvider
from job_agent.services.fit_scorer import JobFitScorer

logger = logging.getLogger(__name__)


class FastSearchManager:
	"""Coordinates high-speed, zero-token job discovery across public endpoints.

	Aggregates from LinkedIn Guest APIs, Freehire ATS, RemoteOK, and WeWorkRemotely.
	Applies multi-key canonical deduplication and seniority hard gates in pure Python
	before persisting qualified vacancies into SQLite.
	"""

	def __init__(
		self,
		tracker: JobTracker | None = None,
		linkedin_scraper: LinkedInGuestScraper | None = None,
		freehire_client: FreehireClient | None = None,
		remoteok_provider: RemoteOKProvider | None = None,
		wwr_provider: WeWorkRemotelyProvider | None = None,
		max_workers: int = 8,
	):
		self.tracker = tracker or JobTracker()
		self.linkedin_scraper = linkedin_scraper or LinkedInGuestScraper()
		self.freehire_client = freehire_client or FreehireClient()
		self.remoteok_provider = remoteok_provider or RemoteOKProvider()
		self.wwr_provider = wwr_provider or WeWorkRemotelyProvider()
		self.max_workers = max_workers

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
		easy_apply_only: bool = False,
	) -> dict[str, Any]:
		"""Execute concurrent multi-source fast discovery and qualification."""
		target_roles = roles or preferences.target_roles or [user_profile.current_role]
		target_locations = locations or preferences.target_locations or ["Remote"]
		min_score = min_fit_score if min_fit_score is not None else preferences.min_fit_score

		# Check if candidate is junior (<= 1.0 year) to automatically enable junior entry filter
		is_junior = float(user_profile.years_of_experience) <= 1.0

		selected_platforms = [p.lower() for p in (platforms or preferences.platforms)]
		has_all = "all" in selected_platforms or not selected_platforms

		include_linkedin = has_all or any("linkedin" in p for p in selected_platforms)
		include_ats = has_all or any(p in ("ats", "freehire") for p in selected_platforms)
		include_remoteok = has_all or any(p in ("remoteok", "rok") for p in selected_platforms)
		include_wwr = has_all or any(p in ("wwr", "weworkremotely") for p in selected_platforms)

		raw_discovered: list[DiscoveredJob] = []
		seen_urls: set[str] = set()
		seen_fingerprints: set[str] = set()

		logger.info(
			f"⚡ Fast-Search starting in parallel across {len(target_roles)} roles and {len(target_locations)} locations "
			f"(Providers: LinkedIn={include_linkedin}, ATS={include_ats}, RemoteOK={include_remoteok}, WWR={include_wwr})..."
		)

		tasks: list[tuple[str, Any]] = []

		for role in target_roles:
			for loc in target_locations:
				if include_linkedin:
					tasks.append((
						f"linkedin:{role}:{loc}",
						lambda r=role, l=loc: self.linkedin_scraper.search(
							query=r,
							location=l,
							remote_mode="remote" if "remote" in l.lower() else None,
							junior_filter=is_junior,
							limit=limit_per_query,
							hydrate_details=hydrate_descriptions,
						),
					))

				if include_ats:
					tasks.append((
						f"ats:{role}:{loc}",
						lambda r=role, l=loc: self.freehire_client.search(
							query=r,
							limit=limit_per_query,
							work_mode="remote" if "remote" in l.lower() else None,
							skills=user_profile.skills[:5],
						),
					))

			# Platform-wide remote searches run once per role (not multiplied by every location)
			if include_remoteok:
				tasks.append((
					f"remoteok:{role}",
					lambda r=role: self.remoteok_provider.search(
						query=r,
						limit=limit_per_query,
					),
				))

			if include_wwr:
				tasks.append((
					f"wwr:{role}",
					lambda r=role: self.wwr_provider.search(
						query=r,
						limit=limit_per_query,
					),
				))

		# Execute network tasks concurrently with ThreadPoolExecutor
		with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
			future_to_label = {executor.submit(func): label for label, func in tasks}
			for future in concurrent.futures.as_completed(future_to_label):
				label = future_to_label[future]
				try:
					jobs: list[DiscoveredJob] = future.result() or []
					for j in jobs:
						# Filter by Easy Apply if requested
						if easy_apply_only and not j.is_easy_apply:
							continue

						clean_url = clean_job_url(j.job_url)
						fingerprint = compute_job_fingerprint(j.company_name, j.job_title)

						if clean_url in seen_urls or fingerprint in seen_fingerprints:
							continue

						if not j.salary_range:
							j.salary_range = extract_salary_from_text(f"{j.job_title} {j.job_description_summary}")

						seen_urls.add(clean_url)
						seen_fingerprints.add(fingerprint)
						raw_discovered.append(j)
				except Exception as ex:
					logger.warning(f"Error during fast search execution ({label}): {ex}")

		logger.info(f"Discovered {len(raw_discovered)} raw unique vacancies. Running candidate qualification gates...")

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
