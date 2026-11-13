# Seguridad

> Modelo de amenazas (STRIDE) y controles de §7: se completan a medida que avanzan los bloques
> (`docs/threat-model/`, BP-SEC-06). Este documento lista **todas** las excepciones a cdk-nag y a checkov (BP-CDK-12).

## Controles de identidad implementados (bloque "Viernes noche")

| Control | Implementación | Evidencia |
|---|---|---|
| Sin auto-registro | `selfSignUpEnabled: false`; usuarios creados por admin | `identity-stack.test.ts` |
| `mall_id` no lo decide el usuario | Atributo `custom:mall_id` **inmutable** y `WriteAttributes: []` en **todos** los app clients | `identity-stack.test.ts` ("ningún cliente puede escribir atributos") |
| Claims en el access token | Pre Token Generation **V2_0**: `mall_id` (entero de 1 a 6 dígitos validado) y `roles` (solo grupos de Cognito conocidos); nunca claims reservados | `functions/identity/pre_token/tests` (casos adversariales) |
| Contraseñas de prueba fuera de la plantilla | Secrets Manager con CMK + custom resource `AdminSetUserPassword`; la plantilla solo lleva el ARN | `identity-stack.test.ts`, `seed_users/tests` |
| Tokens de corta duración | Access/ID de 60 min en dev y 15 min en prod; refresh de 12 h; revocación activa | `identity-stack.test.ts` |
| Cifrado | CMK con rotación para secretos (y AgentCore Memory cuando `memory.enabled`) | `identity-stack.test.ts` |
| CI sin credenciales externas | CDK Pipelines; validación de PR anclada a un único actor de GitHub y con rol solo de lookup | `pipeline-stack.test.ts`, ADR-009 |

## Acknowledgments de cdk-nag (v3: uno por hallazgo)

| Regla | Recurso | Motivo |
|---|---|---|
| IAM5 `Resource::*` | Roles de Lambdas propias (`PythonLambda`) | X-Ray no soporta permisos a nivel de recurso (`PutTraceSegments` y `PutTelemetryRecords`) |
| L1 | Lambdas propias | Python 3.12 en todo el repo (EOL en Lambda: 2028); se sube junto con el resto |
| COG8 | User Pool | El plan Plus (protección contra amenazas) se omite por costo; ESSENTIALS basta para el trigger V2. **(prod)** |
| COG2 (warning) | User Pool | MFA opcional (TOTP) con usuarios sintéticos. **(prod)**: MFA obligatorio para roles internos |
| IAM5 `kms:ReEncrypt*` | Rol de servicio de Memory | Grant del L2 de Memory sobre la CMK propia |
| SMG4 | Secretos de usuarios de prueba (solo dev) | Credenciales sintéticas; rotación como mejora **(prod)** |
| IAM4, IAM5, L1 | Provider framework de los custom resources | Código del framework de aws-cdk-lib |
| S1 | Bucket de artefactos del pipeline | Artefactos efímeros; access logs **(prod)** |
| IAM5 (acciones `s3:*Object*`, `List*`, `GetBucket*`, `Abort*` y `<bucket>/*`) | Roles de CDK Pipelines | Grants sobre el bucket de artefactos propio |
| IAM5 `role/*` y `*` | Self-mutation | Asume los roles `cdk-*` del bootstrap; diseño del framework |
| IAM5 log groups y report groups de CodeBuild | Todos los proyectos de CodeBuild | Política estándar de CodeBuild acotada a cada proyecto (o al rol compartido de assets) |
| CB4 | Proyectos de CodeBuild | Clave administrada de S3; una CMK por pipeline se omite por costo (BP-PIPE-11) |
| IAM5 SSM, Secrets Manager, KMS y Cognito | Rol del smoke | Prefijo del ambiente, sufijo aleatorio de Secrets Manager, condición de alias/ViaService y condición por etiquetas |
| SNS2 | Topic de notificaciones | Solo nombre y estado del pipeline |

## Excepciones de checkov

| Check | Alcance | Motivo |
|---|---|---|
| CKV_AWS_117 | Global | Lambdas fuera de VPC por diseño (ADR-006) |
| CKV_AWS_116 | Global | La DLQ aplica a invocaciones asíncronas; las actuales son síncronas |
| CKV_AWS_173 | Global | Las variables de entorno no contienen secretos (BP-LMB-02) |
| CKV_AWS_115 | Global | **Límite de concurrencia de la cuenta = 10**: no se puede reservar. Se activa tras el aumento de cuota |
| CKV_AWS_158 | Global | Log groups sin PII ni secretos; CMK por log group **(prod)** |
| CKV_AWS_18 y CKV_AWS_21 | Bucket de artefactos | Artefactos efímeros |
| CKV_AWS_26 | Topic SNS | Sin datos sensibles |
| CKV_AWS_111 | Rol de assets de CDK Pipelines | Diseño del framework |

## Hallazgos de dependencias conocidos

- `npm audit` (2026-11-13): 4 vulnerabilidades **moderadas** en `minimatch`, empaquetado dentro de `aws-cdk-lib`. Están bajo el umbral del gate (`high`) y solo se usan en tiempo de síntesis. Dependabot las corrige al subir aws-cdk-lib.
