#!/usr/bin/env python3
"""
bridge.py
CLI and JSON-RPC command runner for the AutoApply browser-use engine.
Enables Node.js MCP server and external agents to trigger visual CDP automation.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.agent import AutoApplyJobAgent
from engine.schemas import CandidateProfile


async def run_apply(args):
    profile_data = None
    if args.profile and os.path.exists(args.profile):
        with open(args.profile) as f:
            profile_data = CandidateProfile(**json.load(f))
    else:
        profile_data = CandidateProfile()

    agent = AutoApplyJobAgent(
        profile=profile_data,
        cdp_url=args.cdp_url,
        resume_pdf_path=args.resume,
    )

    result = await agent.apply_to_current_tab(
        mode=args.mode,
        custom_pitch=args.pitch,
    )
    print(json.dumps(result.model_dump(), indent=2))
    return 0 if result.success else 1


async def run_search(args):
    profile_data = None
    if args.profile and os.path.exists(args.profile):
        with open(args.profile) as f:
            profile_data = CandidateProfile(**json.load(f))
    else:
        profile_data = CandidateProfile()

    agent = AutoApplyJobAgent(
        profile=profile_data,
        cdp_url=args.cdp_url,
        resume_pdf_path=args.resume,
    )

    results = await agent.search_and_apply(
        query=args.query,
        location=args.location,
        max_jobs=args.max,
        mode=args.mode,
        remote_only=args.remote,
    )
    print(json.dumps([r.model_dump() for r in results], indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description="AutoApply AI - browser-use CDP engine")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Apply command
    apply_parser = subparsers.add_parser("apply", help="Apply to the job open in the active tab")
    apply_parser.add_argument("--mode", choices=["semi-auto", "full-auto"], default="semi-auto")
    apply_parser.add_argument("--pitch", type=str, default=None, help="Custom pitch or cover letter note")
    apply_parser.add_argument("--profile", type=str, default=None, help="Path to profile JSON")
    apply_parser.add_argument("--resume", type=str, default=None, help="Path to resume PDF")
    apply_parser.add_argument("--cdp-url", type=str, default="http://localhost:9222")

    # Search command
    search_parser = subparsers.add_parser("search", help="Search and apply in bulk")
    search_parser.add_argument("--query", type=str, default="AI Engineer")
    search_parser.add_argument("--location", type=str, default="Remote")
    search_parser.add_argument("--max", type=int, default=10)
    search_parser.add_argument("--mode", choices=["semi-auto", "full-auto"], default="semi-auto")
    search_parser.add_argument("--remote", action="store_true", default=True)
    search_parser.add_argument("--profile", type=str, default=None)
    search_parser.add_argument("--resume", type=str, default=None)
    search_parser.add_argument("--cdp-url", type=str, default="http://localhost:9222")

    args = parser.parse_args()

    if args.command == "apply":
        sys.exit(asyncio.run(run_apply(args)))
    elif args.command == "search":
        sys.exit(asyncio.run(run_search(args)))


if __name__ == "__main__":
    main()
