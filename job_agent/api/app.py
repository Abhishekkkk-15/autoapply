from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from job_agent.api.routes import router as api_router

STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_FILE = STATIC_DIR / "index.html"

app = FastAPI(
	title="AutoApply AI - Web Dashboard",
	description="Autonomous multi-platform recruitment intelligence and application control center.",
	version="0.1.0",
)

# Enable CORS for local cross-origin development
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# Mount REST API
app.include_router(api_router)


# Serve single-page dashboard at root
@app.get("/", response_class=HTMLResponse)
def serve_index() -> Any:
	"""Serve the single-page dashboard frontend."""
	if INDEX_FILE.exists():
		return FileResponse(INDEX_FILE)
	return HTMLResponse("<h1>AutoApply API is active. Dashboard static files missing.</h1>")


if STATIC_DIR.exists():
	app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
