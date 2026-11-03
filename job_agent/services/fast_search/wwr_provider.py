from __future__ import annotations

import html
import logging
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from job_agent.services.fast_search.deduplicator import clean_job_url
from job_agent.services.fast_search.models import DiscoveredJob

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = (
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
	"(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

WWR_CATEGORY_FEEDS = {
	"programming": "https://weworkremotely.com/categories/remote-programming-jobs.rss",
	"devops": "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
	"fullstack": "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
	"backend": "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
	"frontend": "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
}


def strip_html_tags(text: str) -> str:
	"""Remove HTML tags and collapse whitespaces."""
	if not text:
		return ""
	clean = re.sub(r"<[^>]+>", " ", text)
	clean = html.unescape(clean)
	return re.sub(r"\s+", " ", clean).strip()


class WeWorkRemotelyProvider:
	"""Provider for querying WeWorkRemotely RSS feeds."""

	def __init__(self, timeout: float = 10.0, cache_ttl_seconds: int = 300):
		self.timeout = timeout
		self.cache_ttl = cache_ttl_seconds
		self._feed_cache: dict[str, tuple[float, list[dict[str, str]]]] = {}

	def _fetch_feed(self, url: str) -> list[dict[str, str]]:
		"""Fetch and parse RSS feed items with TTL caching."""
		now = time.time()
		cached = self._feed_cache.get(url)
		if cached and (now - cached[0]) < self.cache_ttl:
			return cached[1]

		req = urllib.request.Request(
			url,
			headers={
				"User-Agent": DEFAULT_USER_AGENT,
				"Accept": "application/rss+xml, application/xml, text/xml",
			},
		)
		items: list[dict[str, str]] = []
		try:
			with urllib.request.urlopen(req, timeout=self.timeout) as resp:
				if resp.status != 200:
					return []
				content = resp.read()
				root = ET.fromstring(content)
				channel = root.find("channel")
				if channel is not None:
					for item_node in channel.findall("item"):
						title_node = item_node.find("title")
						link_node = item_node.find("link")
						desc_node = item_node.find("description")
						date_node = item_node.find("pubDate")

						title_text = title_node.text if title_node is not None and title_node.text else ""
						link_text = link_node.text if link_node is not None and link_node.text else ""
						desc_text = desc_node.text if desc_node is not None and desc_node.text else ""
						date_text = date_node.text if date_node is not None and date_node.text else ""

						if title_text and link_text:
							items.append({
								"title": title_text,
								"link": link_text,
								"description": desc_text,
								"pubDate": date_text,
							})
			self._feed_cache[url] = (now, items)
		except Exception as ex:
			logger.warning(f"WeWorkRemotely feed query error ({url}): {ex}")
			if cached:
				return cached[1]
		return items

	def search(self, query: str, limit: int = 25) -> list[DiscoveredJob]:
		"""Search WeWorkRemotely RSS feeds for matching engineering roles."""
		query_lower = query.lower().strip()
		query_words = [w for w in re.split(r"[\s/,]+", query_lower) if len(w) > 2]

		# Fetch programming and devops feeds
		feeds_to_check = [
			WWR_CATEGORY_FEEDS["programming"],
			WWR_CATEGORY_FEEDS["devops"],
		]

		raw_items: list[dict[str, str]] = []
		for feed_url in feeds_to_check:
			raw_items.extend(self._fetch_feed(feed_url))

		results: list[DiscoveredJob] = []
		seen_links: set[str] = set()

		for item in raw_items:
			full_title = item["title"]
			raw_link = item["link"]
			if raw_link in seen_links:
				continue

			# WWR title format is commonly "Company: Job Title"
			if ":" in full_title:
				parts = full_title.split(":", 1)
				company = parts[0].strip()
				job_title = parts[1].strip()
			else:
				company = "Unknown Company"
				job_title = full_title.strip()

			title_lower = job_title.lower()
			desc_clean = strip_html_tags(item.get("description", ""))
			desc_lower = desc_clean.lower()

			# Relevance check: query words in title or description
			matches = sum(1 for w in query_words if w in title_lower)
			if query_words and matches == 0 and not any(w in desc_lower[:300] for w in query_words):
				continue

			seen_links.add(raw_link)
			clean_url = clean_job_url(raw_link)

			# Extract job ID from URL (e.g. /remote-jobs/12345-...)
			id_match = re.search(r"/remote-jobs/(\d+)", clean_url)
			job_id = f"wwr-{id_match.group(1)}" if id_match else f"wwr-{abs(hash(clean_url))}"

			# Extract known tech keywords for required_skills
			common_skills = [
				"python", "go", "golang", "react", "node", "typescript", "javascript",
				"fastapi", "docker", "kubernetes", "aws", "postgresql", "rust", "ruby",
				"graphql", "next.js", "vue", "django", "elixir", "ai", "llm"
			]
			matched_skills = [s.title() for s in common_skills if re.search(rf"\b{s}\b", desc_lower)]

			results.append(
				DiscoveredJob(
					job_id=job_id,
					job_title=job_title,
					company_name=company,
					job_url=clean_url,
					platform="weworkremotely",
					location="Remote",
					job_description_summary=desc_clean[:1500],
					required_skills=matched_skills[:8],
					posted_at=item.get("pubDate"),
					is_easy_apply=False,
				)
			)

			if len(results) >= limit:
				break

		logger.info(f"WeWorkRemotely discovered {len(results)} vacancies for '{query}'")
		return results
