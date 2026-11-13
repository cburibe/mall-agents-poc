# MallMind — POC de agentes de IA para centros comerciales sobre AWS

> POC inspirada en el caso de uso de asistentes para malls. **Datos 100 % sintéticos**; malls ficticios.

**Problema.** Los usuarios de negocio quieren consultar APIs y bases de datos internas en lenguaje natural, y los visitantes quieren saber qué hay en stock, dónde y a qué precio.

**Solución.** Una plataforma de agentes con dos caras sobre la misma base técnica:
- **Visitante:** stock, horarios y estacionamiento.
- **Negocio:** ventas, tráfico, contratos y demanda insatisfecha.

Construida con AgentCore (Runtime, Memory, Gateway), Strands + LangGraph, RAG con pgvector, Redshift, CDK y CDK Pipelines. Las decisiones están en [`docs/adr/`](docs/adr/).

## Estado

| Bloque | Estado |
|---|---|
| Viernes noche: repo, `Makefile`, `PipelineStack` (CDK Pipelines) e `IdentityStack` (Cognito, KMS, Memory) | En curso |

## Cómo correrlo

```bash
export AWS_PROFILE=mall-agents-poc
make tools && make ci        # lint, tests, seguridad, synth + cdk-nag, checkov
```

Despliegue y operación: [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Seguridad y excepciones: [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md). CI/CD: [`docs/adr/ADR-009-cicd.md`](docs/adr/ADR-009-cicd.md).

## Estructura

```
infra/        CDK TypeScript (stages, stacks, constructs, aspects, tests)
functions/    Lambdas Python (uv + Powertools), p. ej. identity/pre_token
scripts/      instalación de herramientas fijadas y smoke tests
agents/ tools/ data/ evals/ bench/ ui/ proxy/ config/   (próximos bloques)
docs/         ADRs, RUNBOOK, SEGURIDAD
```
