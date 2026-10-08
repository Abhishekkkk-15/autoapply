from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Load local .env
load_dotenv(Path(__file__).parent / ".env")
load_dotenv()

from browser_use import Agent, BrowserProfile, BrowserSession, Tools
from browser_use.tools.views import UploadFileAction
from engine.schemas import ApplyResult, CandidateProfile

logger = logging.getLogger("autoapply.engine")


def get_default_llm():
    """Initializes LLM client based on available environment variables."""
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    if gemini_key:
        from browser_use import ChatGoogle
        return ChatGoogle(model="gemini-2.5-flash")
    elif openai_key:
        from browser_use import ChatOpenAI
        return ChatOpenAI(model="gpt-4o")
    elif anthropic_key:
        from browser_use import ChatAnthropic
        return ChatAnthropic(model="claude-3-5-sonnet-20241022")
    else:
        # Default to Gemini if no key set yet, which will raise helpful message on run
        from browser_use import ChatGoogle
        return ChatGoogle(model="gemini-2.5-flash")


class AutoApplyJobAgent:
    def __init__(
        self,
        profile: Optional[CandidateProfile] = None,
        cdp_url: str = "http://localhost:9222",
        resume_pdf_path: Optional[str] = None,
    ):
        self.profile = profile or CandidateProfile()
        self.cdp_url = cdp_url
        self.resume_pdf_path = (
            resume_pdf_path
            or self.profile.resumePdfPath
            or "/home/abhishek/Downloads/resume.pdf"
        )
        if not os.path.exists(self.resume_pdf_path):
            # Fallback search
            alt = Path("/mnt/dev/downloads/ABHISHEK_JANGID_2026_resume.docx.pdf")
            if alt.exists():
                self.resume_pdf_path = str(alt)

    def _build_candidate_context(self) -> str:
        p = self.profile
        return f"""
CANDIDATE SOURCE OF TRUTH:
- Full Name: {p.fullName}
- Email: {p.email}
- Phone Number: {p.phone} (10-digit: {p.phone.replace('+91', '').strip()}, Country: India +91)
- Location: {p.currentLocation}
- Portfolio / Website: {p.portfolioUrl}
- LinkedIn: {p.linkedinUrl}
- GitHub: {p.githubUrl}
- Years of Experience: {p.yearsOfExperience} years
- Notice Period: {p.noticePeriodDays} days (Immediate)
- Expected Salary: {p.expectedSalaryNumeric} {p.currency}
- Work Authorization: Authorized in target country = {p.workAuthorization.authorizedInTargetCountry}, Requires sponsorship = {p.workAuthorization.requiresSponsorship}, US Citizen = {p.workAuthorization.usCitizen}

ANTI-HALLUCINATION RULES:
1. NEVER invent quantitative metrics, percentages, revenue, or team numbers unless present in the candidate's background.
2. If asked about a skill or technology not in the candidate's profile, answer honestly (0 years / None) or assess based strictly on actual skills.
3. Phone number input: if country code dropdown exists, choose India (+91) and input the 10-digit number.
4. If a resume upload field is present, use upload_file action with path "{self.resume_pdf_path}".
"""

    async def apply_to_current_tab(
        self,
        mode: str = "semi-auto",
        custom_pitch: Optional[str] = None,
    ) -> ApplyResult:
        """
        Inspects the active tab in Chrome via CDP, clicks Easy Apply / Apply,
        fills all form steps, attaches resume, and either stops at Review (semi-auto)
        or completes submission (full-auto).
        """
        llm = get_default_llm()
        tools = Tools()

        # Add custom upload tool if needed
        resume_file = self.resume_pdf_path
        available_files = [resume_file] if os.path.exists(resume_file) else []

        session = BrowserSession(
            browser_profile=BrowserProfile(cdp_url=self.cdp_url, is_local=True)
        )

        pitch_instruction = (
            f'For cover letter, note, or pitch fields, use this tailored pitch note: "{custom_pitch}"'
            if custom_pitch
            else 'For pitch or cover letter, write a concise ~120-word tailored note highlighting full-stack AI systems engineering.'
        )

        submission_instruction = (
            """
IMPORTANT (SEMI-AUTO MODE):
- Advance through each step of the application by filling in all required questions.
- Once you reach the final step titled "Review" or the button says "Submit application", DO NOT CLICK SUBMIT.
- Leave the modal open at the Review step and call the 'done' action with a summary of the filled application.
"""
            if mode == "semi-auto"
            else """
IMPORTANT (FULL-AUTO MODE):
- Advance through all steps, reach the final Review step, and click "Submit application".
- Wait for the submission confirmation / success screen, then call the 'done' action.
"""
        )

        task = f"""
Goal: Apply to the job opening currently displayed on the active browser tab.
{self._build_candidate_context()}

Instructions:
1. Visually check if an "Easy Apply" or "Apply" button is present on the page.
2. Click the "Easy Apply" button to open the application modal/dialog.
3. Fill out the application form step by step:
   - Contact info: Confirm email ({self.profile.email}) and phone ({self.profile.phone}). If country code is asked, select India (+91).
   - Resume: If a resume file upload is requested, attach the resume from {self.resume_pdf_path}.
   - Work authorization / sponsorship: Answer according to candidate profile.
   - Additional questions: Fill them accurately based on candidate skills.
   - {pitch_instruction}
4. Click "Next" to advance through multi-page forms.
5. {submission_instruction}
"""

        agent = Agent(
            task=task,
            llm=llm,
            browser_session=session,
            tools=tools,
            available_file_paths=available_files,
        )

        try:
            history = await agent.run()
            final_result = history.final_result()
            return ApplyResult(
                success=True,
                status="PENDING_APPROVAL" if mode == "semi-auto" else "SUBMITTED",
                message=str(final_result or "Application workflow completed successfully."),
            )
        except Exception as err:
            logger.error(f"Error in apply_to_current_tab: {err}", exc_info=True)
            return ApplyResult(
                success=False,
                status="FAILED",
                message=str(err),
            )
        finally:
            # We do NOT kill session to keep user browser alive
            pass

    async def search_and_apply(
        self,
        query: str = "AI Engineer",
        location: str = "Remote",
        platform: str = "linkedin",
        max_jobs: int = 10,
        mode: str = "semi-auto",
        remote_only: bool = True,
    ) -> list[ApplyResult]:
        """
        Navigates to search results, iterates over jobs, and applies autonomously.
        """
        llm = get_default_llm()
        tools = Tools()
        available_files = [self.resume_pdf_path] if os.path.exists(self.resume_pdf_path) else []

        session = BrowserSession(
            browser_profile=BrowserProfile(cdp_url=self.cdp_url, is_local=True)
        )

        search_url = f"https://www.linkedin.com/jobs/search/?keywords={query}&f_AL=true&f_TPR=r2592000"
        if remote_only:
            search_url += "&f_WT=2"
        if location:
            search_url += f"&location={location}"

        task = f"""
Goal: Search and apply for up to {max_jobs} matching "{query}" roles on LinkedIn.
Search URL: {search_url}

{self._build_candidate_context()}

Workflow:
1. Navigate to {search_url}.
2. For each job card in the search results:
   - Click the job card to load details on the right pane.
   - Verify the role matches {query} and candidate target roles.
   - If "Easy Apply" is present, click it and complete all steps.
   - In {mode} mode: {'stop at Review step for approval' if mode == 'semi-auto' else 'submit and confirm'}.
   - Proceed to the next card until {max_jobs} applications are processed.
"""

        agent = Agent(
            task=task,
            llm=llm,
            browser_session=session,
            tools=tools,
            available_file_paths=available_files,
        )

        history = await agent.run()
        return [
            ApplyResult(
                success=True,
                status="DONE",
                message=str(history.final_result()),
            )
        ]
