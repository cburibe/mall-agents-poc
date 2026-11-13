## Qué cambia

<!-- Título en Conventional Commits: feat|fix|chore|docs|refactor|test|ci(scope): ... -->

## Requisitos (REQ-xxx) y prácticas (BP-xxx)

| Tipo | ID | Cómo se cumple / excepción justificada |
|---|---|---|
| REQ |  |  |
| BP  |  |  |

## Seguridad y costo (BP-GEN-02)

- Datos que toca:
- Permisos IAM nuevos:
- Costo estimado:

## Evidencia

- [ ] `make ci` en verde (salida o enlace al build de `PrValidation`)
- [ ] `cdk diff` revisado (sin `replace` en recursos stateful, BP-CDK-04)
- [ ] Evaluación sin regresión (si cambia prompts, agentes o modelos, BP-AGT-10)
- [ ] Docs / ADR actualizados

## Definition of Done (BP-GEN-04)

- [ ] Código + tests
- [ ] Lint sin errores
- [ ] cdk-nag limpio (supresiones listadas en `docs/SEGURIDAD.md`)
- [ ] Docs/ADR
- [ ] Costo revisado
