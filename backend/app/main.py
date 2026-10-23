from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.routes import router as core_router
from backend.app.config import settings
from backend.app.db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure SQLite database tables exist
    init_db()
    yield


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

