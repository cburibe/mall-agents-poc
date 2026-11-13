# RUNBOOK

## Credenciales locales

```bash
export AWS_PROFILE=mall-agents-poc     # el perfil "default" local tiene credenciales inválidas
aws sts get-caller-identity
```

## Pasos manuales únicos (consola)

Son los únicos pasos de consola permitidos (BP-GEN-03).

1. **Región:** AWS Settings → View all projects → Overview → Additional Info → Region = `us-east-2`.
2. **Bedrock:** caso de soporte (texto en la propuesta, §2.4).
3. **Anthropic (plan B):** crea la API key, fija un límite de gasto y guárdala en Secrets Manager (us-east-2) como `/mall-agents/dev/anthropic-api-key` (texto plano).
4. **Conexión de GitHub:** CodePipeline → Settings → Connections → Create connection (GitHub), nombre `mall-agents-github`. Instala la *AWS Connector for GitHub* **solo en `cburibe/mall-agents-poc`** y espera el estado **Available**. Copia **solo el UUID** del ARN en `infra/lib/config/pipeline-config.ts` (`connectionId`); el ARN se arma con la cuenta al sintetizar.
5. **Cuota de Lambda:** Service Quotas → AWS Lambda → *Concurrent executions* → pide **1000** (la cuenta tiene 10). Hace falta para la concurrencia reservada (BP-LMB-01) y para la demo.
   Solicitudes enviadas el 2026-11-13 por API (estado PENDING): CodeBuild *ARM/Small concurrent builds* (`L-5ED1D25B`) → 5 y Lambda *Concurrent executions* (`L-B99A9384`) → 1000. **La cuenta tiene 0 builds concurrentes de CodeBuild**: hasta que se apruebe, el pipeline falla al arrancar el Synth (`AccountLimitExceededException`) y la validación de PR no corre. Seguimiento: Service Quotas → *Quota request history*.
6. **Caso de soporte AgentCore Memory:** `CreateMemory` responde `AccessDenied ... Contact customer support` (bloqueo de cuenta, como Bedrock). Inclúyelo en el caso de §2.4. Al habilitarse: `memory.enabled: true` en `infra/lib/config/dev.ts`.
7. **Budget:** alertas al 25, 50 y 75 % en *My Monthly Cost Budget*.
8. **Después del primer deploy:**
   - Billing → Cost allocation tags → activa `project` y `env`.
   - SNS → topic `PipelineNotifications` → suscripción por email.

## Primer despliegue

```bash
make tools                               # uv/gitleaks fijados, Python 3.12, npm ci, uv sync
make ci                                  # gates completos
cd infra && npx cdk bootstrap aws://<cuenta>/us-east-2 && cd ..
make deploy-pipeline                     # muestra cdk diff y despliega PipelineStack (única vez)
git push origin main                     # el pipeline hace synth, self-mutation, Dev y smoke
```

Desde aquí, **todo despliegue va por el pipeline**. Para iterar en local está permitido `cd infra && npx cdk deploy 'PipelineStack/Dev/<Stack>'` con su `cdk diff` previo; después hay que hacer push para que el pipeline quede alineado.

## Verificación

```bash
make smoke ENV=dev       # login SRP de 3 usuarios + claims del access token + token M2M
```

## Rollback

- **Stateless:** revertir el commit y hacer push (el pipeline redespliega).
- **Stateful (IdentityStack):** revisar `cdk diff` buscando `replace` antes de cualquier cambio (BP-CDK-04). Si un stack queda en `UPDATE_ROLLBACK_FAILED`: `npx cdk rollback <stack>`.

## Apagar todo

```bash
make destroy ENV=dev                      # stacks del Stage Dev
cd infra && npx cdk destroy PipelineStack # el pipeline
```

En dev, la CMK queda programada para eliminarse en 7 días. Revisa Cost Explorer filtrado por `project=mall-agents-poc`.

## Alarmas

- **Pipeline FAILED:** abre la ejecución en CodePipeline y luego los logs del paso (CodeBuild, 7 días). Si falla `make ci`, reprodúcelo en local.
