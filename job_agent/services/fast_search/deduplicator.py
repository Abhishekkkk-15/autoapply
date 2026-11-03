from __future__ import annotations

import re
import urllib.parse


def clean_job_url(raw_url: str) -> str:
	"""Strip tracking parameters, refIds, and UTM tokens to get a canonical job URL."""
	if not raw_url:
		return ""
	try:
		parsed = urllib.parse.urlparse(raw_url)
		# Filter out tracking query params
		tracking_params = {
			"refid", "trackingid", "trk", "trkinfo", "midtoken", "fromemail",
			"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
			"position", "pagenum", "orig", "currentjobid", "f_al", "f_e", "f_wt"
		}
		query_pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
		clean_pairs = [(k, v) for k, v in query_pairs if k.lower() not in tracking_params]
		clean_query = urllib.parse.urlencode(clean_pairs)

		# Normalize LinkedIn view URL: /jobs/view/12345/
		path = parsed.path.rstrip("/")
		return urllib.parse.urlunparse((
			parsed.scheme,
			parsed.netloc.lower(),
			path,
			parsed.params,
			clean_query,
			"",
		))
	except Exception:
		return raw_url.split("?")[0].rstrip("/")


def clean_company_name(company: str) -> str:
	"""Normalize company name by stripping legal suffixes and punctuation."""
	if not company:
		return "unknown"
	c = company.strip().lower()
	# Remove legal entities
	c = re.sub(r"\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|technologies|solutions|holdings|group|gmbh|pvt\.?|co\.?)\b", "", c)
	# Strip non-alphanumeric
	c = re.sub(r"[^\w\s]", "", c)
	return re.sub(r"\s+", " ", c).strip() or "unknown"


def clean_job_title(title: str) -> str:
	"""Normalize job title by removing brackets, locations, and special badges."""
	if not title:
		return "role"
	t = title.strip().lower()
	# Remove parenthetical tags like (Remote), [Hybrid], (m/f/d), etc.
	t = re.sub(r"[\(\[][^\)\]]*?[\)\]]", "", t)
	# Remove common noise words
	t = re.sub(r"\b(remote|hybrid|onsite|full-?time|part-?time|urgent|immediate)\b", "", t)
	t = re.sub(r"[^\w\s]", "", t)
	return re.sub(r"\s+", " ", t).strip() or "role"


def compute_job_fingerprint(company: str, title: str) -> str:
	"""Compute a canonical cross-platform fingerprint to suppress duplicate postings."""
	c = clean_company_name(company)
	t = clean_job_title(title)
	return f"{c}::{t}"


def extract_salary_from_text(text: str) -> str | None:
	"""Extract disclosed compensation from title or description text."""
	if not text:
		return None
	# USD / EUR / GBP: e.g. $120,000 - $160,000, $120k-$160k, €70,000 - €90,000
	curr_pattern = re.compile(
		r"([$£€]\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:k|K)?\s*(?:-|to|–)\s*[$£€]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:k|K)?(?:\s*(?:/yr|/year|/hr|/hour|per year|annually))?)"
	)
	m = curr_pattern.search(text)
	if m:
		return m.group(1).strip()

	# Single figure: e.g. $150k/yr, $120,000/year
	single_curr = re.compile(
		r"([$£€]\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:k|K)?\s*(?:/yr|/year|/hr|/hour|per year|annually))",
		re.IGNORECASE,
	)
	m_single = single_curr.search(text)
	if m_single:
		return m_single.group(1).strip()

	# INR LPA: e.g. 15-25 LPA, ₹20-30 LPA
	lpa_pattern = re.compile(
		r"((?:₹|rs\.?|inr)?\s*\d{1,3}(?:\.\d+)?\s*(?:-|to|–)\s*\d{1,3}(?:\.\d+)?\s*(?:lpa|lac|lakh|cr)\b)",
		re.IGNORECASE,
	)
	m2 = lpa_pattern.search(text)
	if m2:
		return m2.group(1).strip()

	return None
