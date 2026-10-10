from __future__ import annotations

import html
import logging
import random
import re
import time
import urllib.parse
import urllib.request
from typing import Any

from job_agent.services.fast_search.models import DiscoveredJob

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting"

DEFAULT_HEADERS = {
	"User-Agent": (
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
		"(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
	),
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
	"X-Requested-With": "XMLHttpRequest",
}


def strip_html_tags(text: str) -> str:
	"""Remove HTML tags and collapse whitespace."""
	clean = re.sub(r"<[^>]+>", " ", text)
	clean = html.unescape(clean)
	return re.sub(r"\s+", " ", clean).strip()


class LinkedInGuestScraper:
	"""Lightning-fast unauthenticated scraper leveraging LinkedIn's public jobs-guest endpoints.
	
	Discovers vacancies in milliseconds with zero LLM token cost and zero account risk.
	"""

	def __init__(self, request_timeout: float = 12.0, max_retries: int = 3):
		self.request_timeout = request_timeout
		self.max_retries = max_retries

	def _fetch_html(self, url: str) -> str:
		"""Fetch HTML with exponential backoff on HTTP 429 and 5xx."""
		delay = 0.5
		for attempt in range(self.max_retries + 1):
			req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
			try:
				with urllib.request.urlopen(req, timeout=self.request_timeout) as resp:
					if resp.status == 200:
						return resp.read().decode("utf-8", errors="replace")
			except urllib.error.HTTPError as exc:
				if exc.code == 404:
					return ""
				if exc.code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
					jitter = random.uniform(0.2, 0.6)
					time.sleep(delay + jitter)
					delay = min(delay * 2, 5.0)
					continue
				logger.warning(f"LinkedIn guest request failed ({exc.code}): {url}")
				break
			except Exception as ex:
				if attempt < self.max_retries:
					time.sleep(delay)
					delay = min(delay * 2, 4.0)
					continue
				logger.warning(f"LinkedIn request error: {ex}")
				break
		return ""

	def build_search_url(
		self,
		query: str,
		location: str = "Remote",
		remote_mode: str | None = "remote",
		junior_filter: bool = False,
		time_posted_days: int | None = 14,
		start: int = 0,
	) -> str:
		"""Build URL for LinkedIn guest search API."""
		params: dict[str, Any] = {
			"keywords": query,
			"location": location,
			"start": start,
		}

		# Workplace type: 1 = onsite, 2 = remote, 3 = hybrid
		if remote_mode:
			mode_lower = remote_mode.lower()
			if "remote" in mode_lower:
				params["f_WT"] = "2"
			elif "hybrid" in mode_lower:
				params["f_WT"] = "3"
			elif "onsite" in mode_lower:
				params["f_WT"] = "1"

		# Seniority gate filter: 1 = Internship, 2 = Entry level
		if junior_filter:
			params["f_E"] = "1,2"

		# Recency filter
		if time_posted_days:
			if time_posted_days <= 1:
				params["f_TPR"] = "r86400"
			elif time_posted_days <= 7:
				params["f_TPR"] = "r604800"
			elif time_posted_days <= 30:
				params["f_TPR"] = "r2592000"

		return f"{SEARCH_URL}?{urllib.parse.urlencode(params)}"

	def parse_job_cards(self, html_content: str, is_remote_query: bool = False) -> list[DiscoveredJob]:
		"""Extract structured job cards from LinkedIn guest HTML response."""
		jobs: list[DiscoveredJob] = []
		if not html_content:
			return jobs

		chunks = html_content.split('data-entity-urn="urn:li:jobPosting:')
		for chunk in chunks[1:]:
			# 1. Job ID
			id_match = re.match(r"^(\d+)", chunk)
			if not id_match:
				continue
			job_id = id_match.group(1)

			# 2. Canonical URL
			url_match = re.search(r'class="base-card__full-link[^"]*"[^>]*href="([^"]+)"', chunk, re.IGNORECASE)
			if url_match:
				job_url = html.unescape(url_match.group(1)).split("?")[0]
			else:
				job_url = f"https://www.linkedin.com/jobs/view/{job_id}"

			# 3. Job Title
			title = ""
			title_match = re.search(r'class="base-search-card__title"[^>]*>([\s\S]*?)</h3>', chunk, re.IGNORECASE)
			if title_match:
				title = strip_html_tags(title_match.group(1))
			else:
				sr_match = re.search(r'class="sr-only"[^>]*>([\s\S]*?)</span>', chunk, re.IGNORECASE)
				if sr_match:
					title = strip_html_tags(sr_match.group(1))

			if not title:
				continue

			# 4. Company Name
			company = "Unknown Company"
			comp_match = re.search(r'class="base-search-card__subtitle"[^>]*>([\s\S]*?)</h4>', chunk, re.IGNORECASE)
			if comp_match:
				company = strip_html_tags(comp_match.group(1))

			# 5. Location
			loc = "Remote"
			loc_match = re.search(r'class="job-search-card__location"[^>]*>([\s\S]*?)</span>', chunk, re.IGNORECASE)
			if loc_match:
				loc = strip_html_tags(loc_match.group(1))
				if is_remote_query and "remote" not in loc.lower():
					loc = f"{loc} (Remote)"

			# 6. Date posted
			posted = None
			date_match = re.search(r'<time[^>]*datetime="([^"]+)"[^>]*>([\s\S]*?)</time>', chunk, re.IGNORECASE)
			if date_match:
				posted = strip_html_tags(date_match.group(2)) or date_match.group(1)

			jobs.append(
				DiscoveredJob(
					job_id=job_id,
					job_title=title,
					company_name=company,
					job_url=job_url,
					platform="linkedin",
					location=loc,
					posted_at=posted,
					is_easy_apply=True,
				)
			)

		return jobs

	def fetch_job_detail(self, job_id: str) -> str:
		"""Fetch the complete unauthenticated description for a specific job ID."""
		url = f"{DETAIL_URL}/{job_id}"
		raw_html = self._fetch_html(url)
		if not raw_html:
			return ""

		# Look for description container
		desc_match = re.search(r'class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)</div>', raw_html, re.IGNORECASE)
		if desc_match:
			return strip_html_tags(desc_match.group(1))

		return strip_html_tags(raw_html)

	def search(
		self,
		query: str,
		location: str = "Remote",
		remote_mode: str | None = "remote",
		junior_filter: bool = False,
		time_posted_days: int | None = 14,
		limit: int = 15,
		hydrate_details: bool = False,
	) -> list[DiscoveredJob]:
		"""Execute rapid unauthenticated LinkedIn search."""
		all_jobs: list[DiscoveredJob] = []
		start = 0

		while len(all_jobs) < limit:
			url = self.build_search_url(
				query=query,
				location=location,
				remote_mode=remote_mode,
				junior_filter=junior_filter,
				time_posted_days=time_posted_days,
				start=start,
			)
			content = self._fetch_html(url)
			is_remote = bool(remote_mode and "remote" in remote_mode.lower())
			cards = self.parse_job_cards(content, is_remote_query=is_remote)
			if not cards:
				break

			all_jobs.extend(cards)
			start += len(cards)

			# If page returned fewer than 10, no more pages
			if len(cards) < 10 or start >= 50:
				break

		# Trim to requested limit
		results = all_jobs[:limit]

		if hydrate_details:
			for job in results:
				try:
					desc = self.fetch_job_detail(job.job_id)
					if desc:
						job.job_description_summary = desc[:1500]
					time.sleep(0.15)  # Politeness interval
				except Exception as ex:
					logger.debug(f"Could not hydrate detail for job {job.job_id}: {ex}")

		return results
