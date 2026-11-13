import { IConstruct } from 'constructs';
import { Stack, Validations } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

/**
 * Helpers de acknowledgments de cdk-nag v3 (BP-CDK-12). cdk-nag v3 exige reconocer cada hallazgo
 * por separado; todos llevan motivo y quedan listados en docs/SEGURIDAD.md.
 * Los IDs se calculan (cuenta, región, logical IDs) para no escribir el número de cuenta en el repo.
 */
export function acknowledge(scope: IConstruct, reason: string, ...ids: string[]): void {
  Validations.of(scope).acknowledge(...ids.map((id) => ({ id, reason })));
}

/** Hallazgo IAM5 sobre un recurso. */
export function iam5Resource(resource: string): string {
  return `AwsSolutions-IAM5[Resource::${resource}]`;
}

export function iam5Action(action: string): string {
  return `AwsSolutions-IAM5[Action::${action}]`;
}

/**
 * Para cada proyecto de CodeBuild bajo `scope`: la política estándar que CDK genera para su log group
 * y sus report groups (comodín acotado al propio proyecto) y la falta de CMK propia (CB4).
 */
export function acknowledgeCodeBuildDefaults(scope: IConstruct, cmkReason: string): void {
  const stack = Stack.of(scope);
  for (const child of scope.node.findAll()) {
    if (!(child instanceof codebuild.CfnProject)) continue;
    const logicalId = stack.getLogicalId(child);
    const project = child.node.scope ?? child;
    acknowledge(
      project,
      'Política estándar de CodeBuild: log streams y report groups del propio proyecto (el comodín es el sufijo del stream/report)',
      iam5Resource(`arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/codebuild/<${logicalId}>:*`),
      iam5Resource(`arn:aws:codebuild:${stack.region}:${stack.account}:report-group/<${logicalId}>-*`),
    );
    acknowledge(project, cmkReason, 'AwsSolutions-CB4');
  }
}

/** X-Ray (tracing ACTIVE) no admite ARN de recurso: xray:PutTraceSegments/PutTelemetryRecords sobre "*". */
export const XRAY_REASON =
  'X-Ray no soporta permisos a nivel de recurso: PutTraceSegments/PutTelemetryRecords requieren Resource "*" (tracing ACTIVE, BP-PY-05)';
