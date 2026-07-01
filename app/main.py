"""
Nexus — FastAPI Application Entry-Point
"""

from fastapi import FastAPI
from contextlib import asynccontextmanager

from app.database import engine, Base


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup / shutdown lifecycle hook."""
    yield
    await engine.dispose()


app = FastAPI(
    title="Nexus Messaging API",
    description="Real-time messaging backend — By Qudra Minds",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "app": "Nexus", "version": "0.1.0"}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy"}
