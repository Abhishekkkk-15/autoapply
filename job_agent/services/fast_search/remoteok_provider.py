from __future__ import annotations

import html
import json
import logging
import re
import time
import urllib.request
from typing import Any

from job_agent.services.fast_search.deduplicator import clean_job_url
from job_agent.services.fast_search.models import DiscoveredJob

logger = logging.getLogger(__name__)

REMOTEOK_API_URL = "https://remoteok.com/api"
DEFAULT_USER_AGENT = (
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
	"(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def strip_html_tags(text: str) -> str:
	"""Remove HTML markup and unescape entities."""
	if not text:
		return ""
	clean = re.sub(r"<[^>]+>", " ", text)
	clean = html.unescape(clean)
	return re.sub(r"\s+", " ", clean).strip()


class RemoteOKProvider:
	"""Provider for querying RemoteOK's public verified developer API."""

	def __init__(self, api_url: str = REMOTEOK_API_URL, timeout: float = 10.0, cache_ttl_seconds: int = 300):
		self.api_url = api_url
		self.timeout = timeout
		self.cache_ttl = cache_ttl_seconds
		self._cache_data: list[dict[str, Any]] | None = None
		self._cache_timestamp: float = 0.0

	def _fetch_all_jobs(self) -> list[dict[str, Any]]:
		"""Fetch raw jobs feed with in-memory TTL caching."""
		now = time.time()
		if self._cache_data is not None and (now - self._cache_timestamp) < self.cache_ttl:
			return self._cache_data

		req = urllib.request.Request(
			self.api_url,
			headers={
				"User-Agent": DEFAULT_USER_AGENT,
				"Accept": "application/json",
			},
		)
		try:
			with urllib.request.urlopen(req, timeout=self.timeout) as resp:
				if resp.status != 200:
					return []
				data = json.loads(resp.read().decode("utf-8", errors="replace"))
				if isinstance(data, list) and len(data) > 1:
					# The first item is a legal notice / metadata dict
					jobs_payload = [item for item in data[1:] if isinstance(item, dict) and item.get("position")]
					self._cache_data = jobs_payload
					self._cache_timestamp = now
					return jobs_payload
		except Exception as ex:
			logger.warning(f"RemoteOK API fetch failed: {ex}")
			if self._cache_data is not None:
				return self._cache_data
		return []

	def _matches_query(self, item: dict[str, Any], query_terms: list[str]) -> bool:
		"""Check if job position or tags match any query terms."""
		position = str(item.get("position", "")).lower()
		tags = [str(t).lower() for t in item.get("tags", [])]
		tags_str = " ".join(tags)

		for term in query_terms:
			t = term.lower()
			if t in position or t in tags or t in tags_str:
				return True
		return False

	def search(
		self,
		query: str,
		limit: int = 25,
		location: str | None = None,
		min_salary: float | None = None,
	) -> list[DiscoveredJob]:
		"""Search RemoteOK vacancies matching target query keywords."""
		raw_jobs = self._fetch_all_jobs()
		if not raw_jobs:
			return []

		# Break query into keywords
		query_terms = [q.strip() for q in re.split(r"[\s/,]+", query) if len(q.strip()) > 1]
		if not query_terms:
			query_terms = [query.strip()]

		results: list[DiscoveredJob] = []

		for item in raw_jobs:
			if not self._matches_query(item, query_terms):
				continue

			title = str(item.get("position", "")).strip()
			company = str(item.get("company", "Unknown Company")).strip()
			raw_url = item.get("apply_url") or item.get("url") or ""
			if not raw_url:
				continue
			job_url = clean_job_url(raw_url)

			# Format salary range if available
			sal_min = item.get("salary_min")
			sal_max = item.get("salary_max")
			salary_str = None
			if sal_min and sal_max:
				salary_str = f"${int(sal_min):,} - ${int(sal_max):,} USD"
			elif sal_min:
				salary_str = f"${int(sal_min):,}+ USD"

			if min_salary and sal_max and float(sal_max) < min_salary:
				continue

			job_id = f"rok-{item.get('id')}"
			loc = str(item.get("location") or "Remote").strip()
			desc = strip_html_tags(str(item.get("description", "")))
			tags = [str(t).strip() for t in item.get("tags", []) if t]
			posted = str(item.get("date") or "")

			results.append(
				DiscoveredJob(
					job_id=job_id,
					job_title=title,
					company_name=company,
					job_url=job_url,
					platform="remoteok",
					location=loc if "remote" in loc.lower() else f"{loc} (Remote)",
					salary_range=salary_str,
					job_description_summary=desc[:1500],
					required_skills=tags[:8],
					posted_at=posted,
					is_easy_apply=False,
				)
			)

			if len(results) >= limit:
				break

		logger.info(f"RemoteOK discovered {len(results)} vacancies for '{query}'")
		return results
