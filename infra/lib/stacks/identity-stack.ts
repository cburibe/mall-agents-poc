import { Construct } from 'constructs';
import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { EnvConfig } from '../config/env-config';
import { AgentMemory } from '../constructs/agent-memory';
import { CognitoAuth } from '../constructs/cognito-auth';
import { TestUsers } from '../constructs/test-users';

export interface IdentityStackProps extends StackProps {
  readonly config: EnvConfig;
}

/**
 * Stack STATEFUL (BP-CDK-03): User Pool, CMK y AgentCore Memory.
 * Los IDs de construct de este stack no se renombran (BP-CDK-04; test de logical IDs).
 */
export class IdentityStack extends Stack {
  public readonly key: kms.Key;
  public readonly auth: CognitoAuth;
  public readonly agentMemory: AgentMemory;
  public readonly testUsers?: TestUsers;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, { ...props, terminationProtection: props.config.terminationProtection });
    const { config } = props;
    const paramPrefix = `/mall-agents/${config.envName}`;

    this.key = new kms.Key(this, 'Key', {
      description: `CMK de mall-agents (${config.envName}): secretos, memoria, logs sensibles`,
      enableKeyRotation: true,
      alias: `alias/mall-agents/${config.envName}`,
      pendingWindow: Duration.days(7),
      removalPolicy: config.removalPolicy,
    });

    this.auth = new CognitoAuth(this, 'Auth', {
      envName: config.envName,
      domainPrefix: `${config.cognito.domainPrefix}-${config.envName}-${config.account}`,
      accessTokenValidity: Duration.minutes(config.cognito.accessTokenMinutes),
      removalPolicy: config.removalPolicy,
      logRetentionDays: config.logRetentionDays,
    });

    this.agentMemory = new AgentMemory(this, 'AgentMemory', {
      envName: config.envName,
      encryptionKey: this.key,
      expirationDays: config.memory.expirationDays,
      ltmEnabled: config.memory.ltmEnabled,
    });

    if (config.cognito.seedTestUsers) {
      this.testUsers = new TestUsers(this, 'TestUsers', {
        envName: config.envName,
        userPool: this.auth.userPool,
        encryptionKey: this.key,
        removalPolicy: config.removalPolicy,
        logRetentionDays: config.logRetentionDays,
      });
    }

    // Valores para consumidores fuera de CDK (Amplify, smoke, evals) (§12.1).
    const params: Record<string, string> = {
      region: this.region,
      'cognito/user-pool-id': this.auth.userPool.userPoolId,
      'cognito/web-client-id': this.auth.webClient.userPoolClientId,
      'cognito/orquestador-client-id': this.auth.orquestadorClient.userPoolClientId,
      'cognito/domain': this.auth.domain.baseUrl(),
      'memory/id': this.agentMemory.memory.memoryId,
    };
    if (this.testUsers) {
      for (const [username, secret] of Object.entries(this.testUsers.secrets)) {
        params[`test-users/${username}/secret-arn`] = secret.secretArn;
      }
    }
    for (const [name, value] of Object.entries(params)) {
      new ssm.StringParameter(this, `Param-${name.replace(/[^A-Za-z0-9]/g, '-')}`, {
        parameterName: `${paramPrefix}/${name}`,
        stringValue: value,
      });
    }
  }
}
