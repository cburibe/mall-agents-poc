import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EnvConfig, SUPPORTED_REGION } from './env-config';

export function devConfig(account: string): EnvConfig {
  return {
    envName: 'dev',
    account,
    region: SUPPORTED_REGION,
    removalPolicy: RemovalPolicy.DESTROY,
    terminationProtection: false,
    logRetentionDays: RetentionDays.ONE_WEEK,
    tags: { owner: 'cburibe', costCenter: 'poc-entrevista' },
    cognito: {
      domainPrefix: 'mall-agents',
      seedTestUsers: true,
      accessTokenMinutes: 60,
    },
    memory: {
      expirationDays: 30,
      ltmEnabled: false,
    },
  };
}
