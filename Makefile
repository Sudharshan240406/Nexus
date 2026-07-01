.PHONY: up down build migrate seed logs shell reset

# ─── Docker ──────────────────────────────────────────────────────────────────

up:
	docker compose up --build -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f api

shell:
	docker compose exec api bash

# ─── Database ────────────────────────────────────────────────────────────────

migrate:
	docker compose exec api alembic upgrade head

seed:
	docker compose exec api python seed.py

reset:
	docker compose down -v
	docker compose up --build -d
	@echo "⏳ Waiting for services to become healthy..."
	@sleep 5
	docker compose exec api alembic upgrade head
	docker compose exec api python seed.py
	@echo "✅ Full reset complete!"
