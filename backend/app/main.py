from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.routes import router as core_router
from backend.app.config import settings
from backend.app.db.database import init_db, SessionLocal

logger = logging.getLogger(__name__)


async def _run_scheduled_workflows() -> None:
    """
    Periodic task (every minute) that finds workflows with a matching cron schedule
    and auto-executes them. Cron field format: HH:MM (daily) for MVP simplicity.
    """
    from datetime import datetime, timezone
    from backend.app.db.models import WorkflowDB
    from backend.app.services.workflows import WorkflowService

    now = datetime.now(timezone.utc)
    time_str = now.strftime("%H:%M")

    db = SessionLocal()
    try:
        workflows = db.query(WorkflowDB).filter(
            WorkflowDB.is_active == True,  # noqa: E712
            WorkflowDB.schedule_cron == time_str,
        ).all()

        for wf in workflows:
            logger.info("Cron: auto-running workflow '%s' (%s)", wf.name, wf.id)
            service = WorkflowService(db)
            try:
                await service.run_workflow(wf.id)
                logger.info("Cron: workflow '%s' completed", wf.name)
            except Exception as exc:
                logger.error("Cron: workflow '%s' failed: %s", wf.name, exc)
    finally:
        db.close()


async def _cron_loop() -> None:
    """Background coroutine that ticks every 60 seconds and fires scheduled workflows."""
    while True:
        await asyncio.sleep(60)
        try:
            await _run_scheduled_workflows()
        except Exception as exc:
            logger.error("Cron loop error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure SQLite database tables exist
    init_db()
    # Start background cron loop
    cron_task = asyncio.create_task(_cron_loop())
    yield
    # Shutdown: cancel cron
    cron_task.cancel()
    try:
        await cron_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Idler API",
    description="Local-First Open-Weight AI Agent for Repetitive Computer Tasks",
    version="0.1.0",
    lifespan=lifespan,
)

# Enable CORS for local React/Vite development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(core_router)


@app.get("/")
def root():
    return {
        "project": "Idler",
        "tagline": "Stop doing repetitive work. Let your AI handle it.",
        "status": "online",
        "docs_url": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.host, port=settings.port, reload=True)

