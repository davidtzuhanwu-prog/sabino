.PHONY: dev backend frontend install

dev:
	@echo "Starting backend and frontend..."
	@(cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000) &
	@(cd frontend && npm run dev) &
	@wait

backend:
	cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

install:
	cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
	cd frontend && npm install
