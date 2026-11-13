import { IConstruct } from 'constructs';
import { CfnResource } from 'aws-cdk-lib';

/** Excepción puntual de checkov como metadata del recurso CloudFormation (listada en docs/SEGURIDAD.md). */
export function checkovSkip(scope: IConstruct, id: string, comment: string): void {
  const resource = scope instanceof CfnResource ? scope : scope.node.defaultChild;
  if (!(resource instanceof CfnResource)) {
    throw new Error(`checkovSkip: ${scope.node.path} no tiene un recurso CloudFormation por defecto`);
  }
  const current = (resource.getMetadata('checkov') as { skip?: { id: string; comment: string }[] } | undefined) ?? {};
  resource.addMetadata('checkov', { skip: [...(current.skip ?? []), { id, comment }] });
}
