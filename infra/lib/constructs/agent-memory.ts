import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as kms from 'aws-cdk-lib/aws-kms';
import { acknowledge, iam5Action } from '../aspects/nag';

export interface AgentMemoryProps {
  readonly envName: string;
  readonly encryptionKey: kms.IKey;
  readonly expirationDays: number;
  /** Estrategias LTM integradas (resumen, preferencias, semántica). Usan modelos administrados por AWS (§2.4). */
  readonly ltmEnabled: boolean;
}

/**
 * AgentCore Memory (REQ-AGT-03). Stateful: vive en IdentityStack (§12.1).
 * Los namespaces de las estrategias integradas incluyen {actorId} (aislamiento por usuario, BP-AGT-05).
 */
export class AgentMemory extends Construct {
  public readonly memory: agentcore.Memory;

  constructor(scope: Construct, id: string, props: AgentMemoryProps) {
    super(scope, id);

    this.memory = new agentcore.Memory(this, 'Memory', {
      description: `Memoria de conversaciones de mall-agents (${props.envName})`,
      expirationDuration: Duration.days(props.expirationDays),
      kmsKey: props.encryptionKey,
      memoryStrategies: props.ltmEnabled
        ? [
            agentcore.MemoryStrategy.usingBuiltInSummarization(),
            agentcore.MemoryStrategy.usingBuiltInUserPreference(),
            agentcore.MemoryStrategy.usingBuiltInSemantic(),
          ]
        : [],
    });
    acknowledge(
      this.memory,
      'Grant de KMS generado por el L2 de Memory sobre la CMK propia (kms:ReEncrypt* = ReEncryptFrom/To); recurso acotado a esa clave',
      iam5Action('kms:ReEncrypt*'),
    );
  }
}
