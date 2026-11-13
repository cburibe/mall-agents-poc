# Cada paso del pipeline llama a un objetivo de este Makefile (BP-PIPE-13).
# Uso: make ci | make diff ENV=dev | make smoke ENV=dev | make deploy-pipeline | make destroy ENV=dev

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

ROOT := $(abspath .)
export PATH := $(ROOT)/.tools/bin:$(PATH)
export UV_PYTHON := 3.12
export UV_FROZEN := 1

ENV ?= dev
INFRA := infra
CDK := cd $(INFRA) && npx cdk
PY_PACKAGES := $(sort $(dir $(wildcard functions/*/*/pyproject.toml)))
# Módulos de seguridad con mypy --strict (BP-PY-02): todas las Lambdas lo usan vía su pyproject.

.PHONY: help tools lint test security synth checkov ci diff deploy-pipeline smoke destroy clean

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-16s %s\n", $$1, $$2}'

tools: ## Instala uv/gitleaks fijados, Python 3.12 y dependencias (npm ci, uv sync)
	./scripts/ci/install-tools.sh
	uv python install 3.12
	uv sync
	@for p in $(PY_PACKAGES); do echo "== uv sync $$p"; uv sync --project $$p; done
	cd $(INFRA) && npm ci --no-audit --no-fund

lint: ## ruff, mypy (strict), tsc, eslint, prettier
	uv run ruff check .
	uv run ruff format --check .
	@for p in $(PY_PACKAGES); do echo "== mypy $$p"; (cd $$p && uv run --project . mypy .); done
	cd $(INFRA) && npx tsc --noEmit
	cd $(INFRA) && npx eslint .
	cd $(INFRA) && npx prettier --check .

test: ## pytest con cobertura >= 80% + jest (assertions de CDK)
	@for p in $(PY_PACKAGES); do echo "== pytest $$p"; (cd $$p && uv run --project . pytest -q); done
	cd $(INFRA) && npx jest

security: ## bandit, pip-audit, npm audit, gitleaks
	uv run bandit -q -r functions scripts -x '*/tests/*' -c pyproject.toml
	@for p in $(PY_PACKAGES); do echo "== pip-audit $$p"; \
		uv export --project $$p --no-dev --no-hashes --no-emit-project --format requirements-txt > .tools/req-audit.txt; \
		uv run pip-audit --strict --progress-spinner off -r .tools/req-audit.txt; done
	cd $(INFRA) && npm audit --omit=dev --audit-level=high
	gitleaks dir . --config .gitleaks.toml --redact --no-banner

synth: ## cdk synth con cdk-nag (los errores de nag fallan la síntesis)
	$(CDK) synth --quiet

checkov: ## checkov sobre las plantillas sintetizadas
	uv run checkov -d $(INFRA)/cdk.out --framework cloudformation --config-file .checkov.yaml --quiet --compact

ci: lint test security synth checkov ## Gates completos de CI (BP-PIPE-03)

diff: ## cdk diff del Stage del ambiente (sin change set; usa el rol de lookup)
	@stage=$$( [ "$(ENV)" = "prod" ] && echo Prod || echo Dev ); \
	$(CDK) diff --app cdk.out --no-change-set "PipelineStack/$$stage/*"

deploy-pipeline: ## Despliegue manual ÚNICO del PipelineStack (luego se auto-actualiza)
	$(CDK) diff PipelineStack
	$(CDK) deploy PipelineStack --require-approval broadening

smoke: ## Smoke de identidad contra el ambiente desplegado
	uv run python scripts/smoke/identity_smoke.py --env $(ENV)

destroy: ## Destruye los stacks del Stage dev (no el pipeline)
	@[ "$(ENV)" = "dev" ] || { echo "destroy solo está permitido en dev"; exit 1; }
	$(CDK) destroy "PipelineStack/Dev/*"

clean:
	rm -rf $(INFRA)/cdk.out .tools/req-audit.txt
