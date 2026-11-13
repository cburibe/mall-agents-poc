import { Construct } from 'constructs';
import { Aspects, Stage, StageProps, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { EnvConfig, validateConfig } from '../config/env-config';
import { applyMandatoryTags } from '../aspects/tagging';
import { LogRetentionCheck } from '../aspects/log-retention-check';
import { IdentityStack } from '../stacks/identity-stack';

export interface MallAgentsStageProps extends StageProps {
  readonly config: EnvConfig;
}

/** Un Stage por ambiente (BP-CDK-02). Se agregan stacks a medida que avanzan los bloques. */
export class MallAgentsStage extends Stage {
  public readonly identity: IdentityStack;

  constructor(scope: Construct, id: string, props: MallAgentsStageProps) {
    const config = validateConfig(props.config);
    super(scope, id, { ...props, env: { account: config.account, region: config.region } });

    this.identity = new IdentityStack(this, 'IdentityStack', {
      config,
      description: `mall-agents ${config.envName}: Cognito, KMS y AgentCore Memory (stateful)`,
    });

    applyMandatoryTags(this, config);
    Aspects.of(this).add(new LogRetentionCheck(config.logRetentionDays));
    Validations.of(this).addPlugins(new AwsSolutionsChecks(this, { verbose: true }));
  }
}
