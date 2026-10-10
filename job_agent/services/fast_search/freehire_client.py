from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from typing import Any

from job_agent.services.fast_search.models import DiscoveredJob

logger = logging.getLogger(__name__)

FREEHIRE_AGENT_SEARCH = "https://freehire.me/api/v1/agent/jobs/search"
DEFAULT_HEADERS = {
	"User-Agent": "autoapply/0.1.0 (+https://github.com/Abhishekkkk-15/autoapply)",
	"Accept": "application/json",
}


class FreehireClient:
	"""Client for querying the freehire.me open ATS aggregator API.
	
	Aggregates live job postings across ~50 ATS platforms (Greenhouse, Lever, Ashby, Workday)
	with structured tech skills and seniority metadata.
	"""

	def __init__(self, base_url: str = FREEHIRE_AGENT_SEARCH, timeout: float = 8.0):
		self.base_url = base_url
		self.timeout = timeout

	def search(
		self,
		query: str,
		limit: int = 15,
		work_mode: str | None = "remote",
		skills: list[str] | None = None,
	) -> list[DiscoveredJob]:
		"""Search aggregated tech postings via the freehire agent API."""
		params: dict[str, Any] = {
			"q": query,
			"limit": str(min(limit, 50)),
			"include_description": "true",
			"description_format": "text",
		}

		if work_mode:
			wm = work_mode.lower()
			if "remote" in wm:
				params["work_mode"] = "remote"
			elif "hybrid" in wm:
				params["work_mode"] = "hybrid"
			elif "onsite" in wm:
				params["work_mode"] = "onsite"

		url = f"{self.base_url}?{urllib.parse.urlencode(params)}"
		if skills:
			# Append skill filters if provided
			for sk in skills[:5]:
				url += f"&skills={urllib.parse.quote_plus(sk.lower())}"

		req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
		try:
			with urllib.request.urlopen(req, timeout=self.timeout) as resp:
				if resp.status != 200:
					return []
				data = json.loads(resp.read().decode("utf-8", errors="replace"))
		except Exception as ex:
			logger.debug(f"Freehire API query returned error (graceful fallback): {ex}")
			return []

		results: list[DiscoveredJob] = []
		items = data.get("data", []) if isinstance(data, dict) else []

		for item in items:
			job_id = str(item.get("external_id") or item.get("public_slug") or item.get("id", ""))
			title = item.get("title", "")
			company = item.get("company", "Unknown Company")
			job_url = item.get("url") or item.get("apply_url") or ""
			location = item.get("location") or "Remote"
			desc = item.get("description", "")
			req_skills = item.get("skills", [])
			posted = item.get("posted_at") or item.get("created_at")

			if not title or not job_url:
				continue

			results.append(
				DiscoveredJob(
					job_id=job_id,
					job_title=title,
					company_name=company,
					job_url=job_url,
					platform="ats_aggregator",
					location=location,
					job_description_summary=desc[:1500] if desc else "",
					required_skills=req_skills if isinstance(req_skills, list) else [],
					posted_at=posted,
					is_easy_apply=False,  # Typically directs to company ATS (Greenhouse/Lever)
				)
			)

		return results
