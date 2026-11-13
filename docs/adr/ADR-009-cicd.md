# ADR-009: CI/CD con CDK Pipelines (CodePipeline V2 + CodeBuild ARM)

- **Estado:** aceptado (2026-11-13)
- **Decisores:** dueño de la POC
- **Requisitos:** REQ-DSO-01, REQ-IAC-01, BP-PIPE-01..13, BP-GH-01..05

## Contexto

La propuesta original usaba GitHub Actions con OIDC hacia AWS (BP-GHA-03). Al verificarlo en la cuenta se encontró:

1. **La SCP del Paid Plan de la experiencia nueva de AWS niega `iam:*Provider*`** (`DenyIAMRestrictedActions`). Además, `iam:ListOpenIDConnectProviders` devolvió `AccessDenied ... explicit deny in a service control policy`. **No se puede crear el proveedor OIDC de GitHub** sin activar las funciones avanzadas, que es irreversible y elimina el límite de gasto (§2.1).
2. La misma SCP **permite** `codeconnections:*`, `codepipeline:*`, `codebuild:*` y `events:*`, y **niega** la creación de configuraciones de AWS User Notifications (`notifications:Create*`).
3. GitHub Free con repo privado no ofrece rulesets ni push protection. La API responde *"Upgrade to GitHub Pro or make this repository public"*.

## Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| GitHub Actions + OIDC | Estándar de la industria | **Bloqueado por la SCP** |
| GitHub Actions + claves de IAM user | Funciona | Credenciales de larga duración: viola BP-GHA-03 y §2.2 |
| GitHub Actions con runners alojados en CodeBuild | Sin claves; workflows en GitHub | Dos superficies de configuración; riesgo de que un fork ejecute código en el runner |
| **CDK Pipelines (CodePipeline V2 + CodeBuild)** | Nativo de AWS, definido en el mismo código CDK, sin credenciales fuera de AWS, self-mutation | Menos familiar en equipos que usan GitHub Actions; un despliegue manual inicial |

## Decisión

**CDK Pipelines** (`aws-cdk-lib/pipelines`) con:

- `pipelineType: V2`, `crossAccountKeys: false`, `selfMutation: true`, `publishAssetsInParallel: true`, `cliVersion` fijada.
- Fuente: **CodeConnections** a `cburibe/mall-agents-poc`. La app *AWS Connector for GitHub* se instala solo en ese repo (BP-GH-05).
- CodeBuild sobre la imagen ARM fijada `amazonlinux-aarch64-standard:4.0`, tamaño `SMALL`, `privileged` (Docker para el bundling e imágenes ARM64), timeout de 30 min, caché local y logs con 7 días de retención.
- **Cada paso es un objetivo del `Makefile`:** `make tools`, `make ci`, `make smoke ENV=dev` y `make diff ENV=dev` (BP-PIPE-13). Migrar a GitHub Actions o GitLab CI solo cambia la orquestación.
- **Validación de PR** (`PrValidation`): proyecto de CodeBuild con la misma conexión (`Source.Auth = CODECONNECTIONS`). Corre `make ci && make diff ENV=dev` y reporta el estado al PR.
  - El webhook está filtrado por `ACTOR_ACCOUNT_ID` y `BASE_REF`, ambos **anclados** (`^…$`), porque los patrones son regex.
  - En un repo público, un PR de terceros **no** ejecuta builds con el rol de esta cuenta.
  - El rol solo puede asumir el rol de **lookup** del bootstrap (lectura), nunca el de deploy.
- **Post-step de smoke** en el Stage Dev. Su rol solo tiene lectura de SSM `/mall-agents/dev/*`, `GetSecretValue` sobre `/mall-agents/dev/test-users/*`, `kms:Decrypt` condicionado al alias y a `ViaService`, y `DescribeUserPoolClient` condicionado por etiquetas.
- **Notificaciones:** reglas de EventBridge (ejecución FAILED y aprobación pendiente) que publican en un topic SNS con SSL obligatorio. La suscripción por email se hace a mano, para que el email no quede en un repo público.
- **Repo público** para tener rulesets, secret scanning y push protection en GitHub Free. Los datos son sintéticos y no hay secretos en el repo (gitleaks en pre-commit y en `make ci`).

## Consecuencias

- `PipelineStack` se despliega **una vez a mano** (`make deploy-pipeline`); después todo despliegue va por el pipeline.
- Prod existe en código (`prodConfig`, `ManualApprovalStep`) pero no se despliega (`prodEnabled: false`).
- BP-GHA-01..12 (GitHub Actions) se reemplazan por BP-PIPE-01..13. En producción, con una cuenta estándar u Organizations, OIDC vuelve a ser opción. Pregunta abierta para el cliente: ¿cuál es su estándar de CI/CD?
- Costo: CodePipeline V2 cobra por minuto de acción y CodeBuild ARM `SMALL` por minuto de build. Con pocas ejecuciones al día el costo es bajo; se revisa en Cost Explorer por etiqueta.
