import { IConstruct } from 'constructs';
import { Tags } from 'aws-cdk-lib';
import { EnvConfig, PROJECT_TAG } from '../config/env-config';

/** Etiquetas obligatorias en todo recurso etiquetable (BP-CDK-15, BP-COST-01). */
export function applyMandatoryTags(scope: IConstruct, config: Pick<EnvConfig, 'envName' | 'tags'>): void {
  const tags = Tags.of(scope);
  tags.add('project', PROJECT_TAG);
  tags.add('env', config.envName);
  tags.add('owner', config.tags.owner);
  tags.add('cost-center', config.tags.costCenter);
}
