from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class DiscoveredJob(BaseModel):
	"""Structured representation of a job vacancy discovered via fast-path search."""

	job_id: str = Field(description="Unique vacancy or card identifier from the source")
	job_title: str = Field(description="Title of the job posting")
	company_name: str = Field(description="Hiring company or organization name")
	job_url: str = Field(description="Canonical URL to view or apply for the job")
	platform: str = Field(default="linkedin", description="Job board or provider name")
	location: str = Field(default="Remote", description="Job location or remote status")
	job_description_summary: str = Field(default="", description="Full description or summary text")
	required_skills: list[str] = Field(default_factory=list, description="Extracted or declared skills")
	salary_range: str | None = Field(default=None, description="Disclosed compensation range")
	is_easy_apply: bool = Field(default=True, description="Whether direct fast application is supported")
	posted_at: str | None = Field(default=None, description="Posting date or relative age")
	match_score: float = Field(default=0.0, description="Calculated fit score (0-100)")
	notes: str | None = Field(default=None, description="Qualification reasoning or metadata")

	def to_db_dict(self) -> dict[str, Any]:
		"""Convert to database-compatible dictionary for JobTracker.add_job."""
		return {
			"job_title": self.job_title,
			"company_name": self.company_name,
			"job_url": self.job_url,
			"platform": self.platform,
			"location": self.location,
			"salary_range": self.salary_range,
			"job_description_summary": self.job_description_summary,
			"required_skills": self.required_skills,
			"application_type": "easy_apply" if self.is_easy_apply else "external",
			"status": "found",
			"match_score": self.match_score,
			"notes": self.notes or f"Discovered via fast-search on {self.platform}",
		}
