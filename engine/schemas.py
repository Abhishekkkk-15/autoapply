from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, Field


class WorkAuthorization(BaseModel):
    authorizedInTargetCountry: bool = True
    requiresSponsorship: bool = False
    usCitizen: bool = False


class JobPreferences(BaseModel):
    blacklistedCompanies: List[str] = Field(default_factory=list)
    targetRoles: List[str] = Field(default_factory=list)
    maxDaysOld: int = 30
    minSalary: int = 0
    remoteOnly: bool = True


class CandidateProfile(BaseModel):
    fullName: str = "Abhishek Jangid"
    email: str = "abhishekjangid3489@gmail.com"
    phone: str = "+919799219379"
    currentLocation: str = "Jodhpur, Rajasthan, India"
    portfolioUrl: str = "https://abhishekkkk.in"
    linkedinUrl: str = "https://www.linkedin.com/in/abhishek-jangid-3532b1323"
    githubUrl: str = "https://github.com/abhishekkkk-15"
    yearsOfExperience: int = 1
    noticePeriodDays: int = 0
    expectedSalaryNumeric: int = 50000
    currency: str = "USD"
    workAuthorization: WorkAuthorization = Field(default_factory=WorkAuthorization)
    resumeMarkdown: str = ""
    resumePdfPath: Optional[str] = "/home/abhishek/Downloads/resume.pdf"
    jobPreferences: JobPreferences = Field(default_factory=JobPreferences)


class ApplyResult(BaseModel):
    success: bool
    status: str  # SUBMITTED, PENDING_APPROVAL, SKIPPED, FAILED
    job_title: Optional[str] = None
    company: Optional[str] = None
    url: Optional[str] = None
    message: str = ""
    steps_completed: int = 0
    details: Optional[dict[str, Any]] = None
