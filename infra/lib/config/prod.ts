import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EnvConfig, SUPPORTED_REGION } from './env-config';

/** Prod simulado: existe en código para mostrar el patrón; no se despliega en la POC (pipelineConfig.prodEnabled). */
export function prodConfig(account: string): EnvConfig {
  return {
    envName: 'prod',
    account,
    region: SUPPORTED_REGION,
    removalPolicy: RemovalPolicy.RETAIN,
    terminationProtection: true,
    logRetentionDays: RetentionDays.ONE_WEEK,
    tags: { owner: 'cburibe', costCenter: 'poc-entrevista' },
    cognito: {
      domainPrefix: 'mall-agents',
      seedTestUsers: false,
      accessTokenMinutes: 15,
    },
    memory: {
      expirationDays: 30,
      ltmEnabled: false,
    },
  };
}
