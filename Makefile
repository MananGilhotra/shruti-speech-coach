# SHRUTI — one command per stage. `make reproduce` re-runs everything that produces a reported number.
PY      ?= .venv/bin/python
WORKERS ?= 4

.PHONY: help setup data originals dataset verify predict-dev predict-test eval demos web serve test test-all lint reproduce freeze docker clean

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

setup: ## create .venv (Python 3.12) and install pinned dependencies
	uv venv --python 3.12 .venv
	uv pip install --python $(PY) -r requirements.lock
	uv pip install --python $(PY) -e . --no-deps

data: ## download the public-domain source recordings (SHA-256 checked)
	$(PY) -m shruti download

originals: ## cut the six reference excerpts (committed; only needed to rebuild them)
	$(PY) -m shruti originals --force

dataset: ## regenerate every synthetic SHRUTI-Bench render from its recipe
	$(PY) -m shruti dataset --workers 6

verify: ## check renders against the SHA-256 sums in data/bench/labels.jsonl
	$(PY) -m shruti verify

predict-dev: ## run the detector over the dev split (S1-S4)
	$(PY) -m shruti predict --split dev --workers $(WORKERS) --tag frozen

predict-test: ## run the detector over the held-out test split (S5-S6) -- only on the frozen tag
	$(PY) -m shruti predict --split test --workers $(WORKERS) --tag frozen

eval: ## metrics, tables and figures into results/benchmark
	$(PY) -m shruti eval --tag frozen

demos: ## pre-compute Judge Mode analyses and the explorer audio pack
	$(PY) -m shruti demos

web: ## build the dashboard into web/dist
	cd web && npm ci && npm run build

serve: ## API + dashboard on http://127.0.0.1:8000
	$(PY) -m shruti serve

test: ## fast unit tests
	SHRUTI_FAST_TESTS=1 $(PY) -m pytest -q

test-all: ## unit + integration tests (downloads the wav2vec2 model on first run)
	$(PY) -m pytest -q

lint:
	$(PY) -m ruff check src tests

reproduce: data dataset verify predict-dev predict-test eval ## rebuild data, renders and every reported metric
	$(PY) -m shruti reproduce

docker: ## build and run the container (API + dashboard on :8000)
	docker compose -f docker/compose.yaml up --build

clean:
	rm -rf results/cache data/renders
