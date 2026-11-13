import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export type EnvName = 'dev' | 'prod';

/** Configuración tipada por ambiente (BP-CDK-07, BP-CDK-08). */
export interface EnvConfig {
  readonly envName: EnvName;
  /** Cuenta AWS; se resuelve en bin/app.ts y se valida aquí. */
  readonly account: string;
  readonly region: string;
  /** DESTROY en dev; RETAIN en prod (BP-CDK-14). */
  readonly removalPolicy: RemovalPolicy;
  /** Solo en prod para stacks stateful (BP-CDK-03). */
  readonly terminationProtection: boolean;
  readonly logRetentionDays: RetentionDays;
  readonly tags: {
    readonly owner: string;
    readonly costCenter: string;
  };
  readonly cognito: {
    /** Prefijo del dominio de Cognito; se completa con ambiente y cuenta para unicidad global. */
    readonly domainPrefix: string;
    /** Crea los usuarios de prueba (uno por rol). Solo dev. */
    readonly seedTestUsers: boolean;
    readonly accessTokenMinutes: number;
  };
  readonly memory: {
    /** Expiración de eventos STM (7..365 días). */
    readonly expirationDays: number;
    /** Estrategias LTM integradas; usan modelos administrados (§2.4). */
    readonly ltmEnabled: boolean;
  };
}

export const PROJECT_TAG = 'mall-agents-poc';
export const SUPPORTED_REGION = 'us-east-2';

/** Valida la config al sintetizar; lanza con un mensaje accionable. */
export function validateConfig(config: EnvConfig): EnvConfig {
  const errors: string[] = [];
  if (!/^\d{12}$/.test(config.account)) {
    errors.push(`account inválida: "${config.account}" (se esperaban 12 dígitos)`);
  }
  if (config.region !== SUPPORTED_REGION) {
    errors.push(`region debe ser ${SUPPORTED_REGION} (región fija del proyecto), no "${config.region}"`);
  }
  if (config.logRetentionDays !== RetentionDays.ONE_WEEK) {
    errors.push('logRetentionDays debe ser 7 (§2.3)');
  }
  if (config.memory.expirationDays < 7 || config.memory.expirationDays > 365) {
    errors.push('memory.expirationDays debe estar entre 7 y 365');
  }
  if (config.cognito.accessTokenMinutes < 5 || config.cognito.accessTokenMinutes > 60) {
    errors.push('cognito.accessTokenMinutes debe estar entre 5 y 60 (tokens de corta duración, BP-SEC-05)');
  }
  if (!/^[a-z0-9-]{3,30}$/.test(config.cognito.domainPrefix)) {
    errors.push('cognito.domainPrefix solo admite [a-z0-9-] (3-30 caracteres)');
  }
  if (config.envName === 'prod') {
    if (config.removalPolicy !== RemovalPolicy.RETAIN) errors.push('prod exige removalPolicy RETAIN');
    if (!config.terminationProtection) errors.push('prod exige terminationProtection');
    if (config.cognito.seedTestUsers) errors.push('prod no puede crear usuarios de prueba');
  }
  if (errors.length > 0) {
    throw new Error(`Config inválida para "${config.envName}":\n - ${errors.join('\n - ')}`);
  }
  return config;
}
