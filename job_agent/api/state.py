from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)


class RunnerState:
	"""Tracks background autonomous execution and in-memory log buffer."""

	def __init__(self, max_logs: int = 500):
		self.is_running: bool = False
		self.current_task: str = "idle"
		self.started_at: str | None = None
		self.finished_at: str | None = None
		self.last_error: str | None = None
		self.max_logs: int = max_logs
		self.logs: list[str] = []
		self._active_async_task: asyncio.Task[Any] | None = None

	def log(self, message: str) -> None:
		"""Append a timestamped log entry."""
		timestamp = datetime.now(UTC).strftime("%H:%M:%S")
		entry = f"[{timestamp}] {message}"
		self.logs.append(entry)
		if len(self.logs) > self.max_logs:
			self.logs.pop(0)

	def start_run(self, task_name: str, coro: Any) -> bool:
		"""Start an asynchronous background task if not already running."""
		if self.is_running:
			return False
		self.is_running = True
		self.current_task = task_name
		self.started_at = datetime.now(UTC).isoformat()
		self.finished_at = None
		self.last_error = None
		self.log(f"Started task: {task_name}")

		loop = asyncio.get_event_loop()
		self._active_async_task = loop.create_task(self._wrapper(coro))
		return True

	async def _wrapper(self, coro: Any) -> None:
		"""Execute task with error and completion tracking."""
		try:
			await coro
			self.log(f"Task completed successfully: {self.current_task}")
		except asyncio.CancelledError:
			self.log(f"Task was cancelled: {self.current_task}")
		except Exception as ex:
			logger.exception("Background task failed")
			self.last_error = str(ex)
			self.log(f"ERROR: {ex}")
		finally:
			self.is_running = False
			self.finished_at = datetime.now(UTC).isoformat()
			self._active_async_task = None

	def cancel(self) -> bool:
		"""Cancel the currently running task if active."""
		if self._active_async_task and not self._active_async_task.done():
			self._active_async_task.cancel()
			self.is_running = False
			self.log("Cancellation signal sent to background task.")
			return True
		return False

	def to_dict(self) -> dict[str, Any]:
		"""Serialize runner status."""
		return {
			"is_running": self.is_running,
			"current_task": self.current_task,
			"started_at": self.started_at,
			"finished_at": self.finished_at,
			"last_error": self.last_error,
			"recent_logs": self.logs[-50:],
		}


# Global singleton instance
runner_state = RunnerState()
