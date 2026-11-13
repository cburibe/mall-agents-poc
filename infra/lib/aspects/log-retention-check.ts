import { IConstruct } from 'constructs';
import { Annotations, IAspect, Tokenization } from 'aws-cdk-lib';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';

/**
 * Falla la síntesis (annotation de error) si un log group no tiene la retención esperada (BP-CDK-15, §2.3).
 * `cdk synth --strict` y los tests convierten el error en fallo.
 */
export class LogRetentionCheck implements IAspect {
  constructor(private readonly expectedDays: number) {}

  public visit(node: IConstruct): void {
    if (!(node instanceof CfnLogGroup)) return;
    const days = node.retentionInDays;
    if (days === undefined) {
      Annotations.of(node).addError(`Log group sin retención; se esperaban ${this.expectedDays} días`);
      return;
    }
    if (!Tokenization.isResolvable(days) && days !== this.expectedDays) {
      Annotations.of(node).addError(`Retención ${days} días; se esperaban ${this.expectedDays}`);
    }
  }
}
