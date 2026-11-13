import * as path from 'path';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { acknowledge } from '../aspects/nag';
import { PythonLambda } from './python-lambda';

/** Grupos de Cognito = roles de la POC (REQ-SEC-03). El orden no importa; el nombre es contrato. */
export const USER_GROUPS = ['visitante', 'gerente_mall', 'analista', 'admin'] as const;
export type UserGroup = (typeof USER_GROUPS)[number];

export const RESOURCE_SERVER_ID = 'mall-tools';
/** Cognito no admite "/" en el nombre del scope; el scope completo queda "mall-tools/tools.read". */
export const SCOPE_READ = 'tools.read';
export const SCOPE_WRITE = 'tools.write';

export interface CognitoAuthProps {
  readonly envName: string;
  readonly domainPrefix: string;
  readonly accessTokenValidity: Duration;
  readonly removalPolicy: RemovalPolicy;
  readonly logRetentionDays: RetentionDays;
}

/**
 * User Pool de la POC con grupos, resource server, app clients y el trigger
 * Pre Token Generation V2 (vive junto al pool para evitar dependencias cíclicas, §12.1).
 */
export class CognitoAuth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly webClient: cognito.UserPoolClient;
  public readonly orquestadorClient: cognito.UserPoolClient;
  public readonly locatariosClient: cognito.UserPoolClient;
  public readonly resourceServer: cognito.UserPoolResourceServer;
  public readonly domain: cognito.UserPoolDomain;
  public readonly preTokenLambda: PythonLambda;

  constructor(scope: Construct, id: string, props: CognitoAuthProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      // ESSENTIALS: requerido para personalizar el access token (trigger V2_0).
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      // Usuarios administrados por admin; sin email ni SMS no hay recuperación de autoservicio.
      accountRecovery: cognito.AccountRecovery.NONE,
      customAttributes: {
        // Inmutable: un usuario no puede cambiarse de mall (anti cross-tenant, ADV-03).
        mall_id: new cognito.StringAttribute({ minLen: 1, maxLen: 6, mutable: false }),
      },
      deletionProtection: props.removalPolicy === RemovalPolicy.RETAIN,
      removalPolicy: props.removalPolicy,
    });

    acknowledge(
      this.userPool,
      'Plan Plus (protección contra amenazas) omitido por costo en la POC; ESSENTIALS basta para el trigger V2. Mejora (prod), BP-SEC-05',
      'AwsSolutions-COG8',
    );
    acknowledge(
      this.userPool,
      'MFA opcional (TOTP) en la POC con usuarios sintéticos; en prod MFA obligatorio para roles internos, BP-SEC-05',
      'AwsSolutions-COG2',
    );

    for (const group of USER_GROUPS) {
      new cognito.UserPoolGroup(this, `Group-${group}`, {
        userPool: this.userPool,
        groupName: group,
        description: `Rol ${group} de la POC`,
      });
    }

    const readScope = new cognito.ResourceServerScope({
      scopeName: SCOPE_READ,
      scopeDescription: 'Invocar tools de lectura del Gateway',
    });
    const writeScope = new cognito.ResourceServerScope({
      scopeName: SCOPE_WRITE,
      scopeDescription: 'Invocar tools de escritura (crear_*) del Gateway',
    });
    this.resourceServer = this.userPool.addResourceServer('ResourceServer', {
      identifier: RESOURCE_SERVER_ID,
      userPoolResourceServerName: 'Mall Agents tools',
      scopes: [readScope, writeScope],
    });

    this.domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.domainPrefix },
    });

    // Lectura de mall_id permitida; escritura de ningún atributo desde el cliente.
    const readAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({ preferredUsername: true })
      .withCustomAttributes('mall_id');

    this.webClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `web-${props.envName}`,
      generateSecret: false,
      authFlows: { userSrp: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      readAttributes,
      writeAttributes: new cognito.ClientAttributes(),
      accessTokenValidity: props.accessTokenValidity,
      idTokenValidity: props.accessTokenValidity,
      refreshTokenValidity: Duration.hours(12),
    });

    const m2mClient = (clientId: string, name: string, scopes: cognito.ResourceServerScope[]) =>
      this.userPool.addClient(clientId, {
        userPoolClientName: `${name}-${props.envName}`,
        generateSecret: true,
        authFlows: {},
        oAuth: {
          flows: { clientCredentials: true },
          scopes: scopes.map((s) => cognito.OAuthScope.resourceServer(this.resourceServer, s)),
        },
        preventUserExistenceErrors: true,
        writeAttributes: new cognito.ClientAttributes(),
        accessTokenValidity: props.accessTokenValidity,
      });

    this.orquestadorClient = m2mClient('OrquestadorM2MClient', 'orquestador-m2m', [readScope, writeScope]);
    this.locatariosClient = m2mClient('LocatariosM2MClient', 'locatarios-m2m', [readScope, writeScope]);

    this.preTokenLambda = new PythonLambda(this, 'PreTokenGeneration', {
      entry: path.join(__dirname, '..', '..', '..', 'functions', 'identity', 'pre_token'),
      serviceName: 'pre-token-generation',
      description: 'Copia mall_id y roles validados al access token (Pre Token Generation V2)',
      logRetentionDays: props.logRetentionDays,
      removalPolicy: props.removalPolicy,
      timeout: Duration.seconds(5),
      memorySize: 256,
    });
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      this.preTokenLambda.function,
      cognito.LambdaVersion.V2_0,
    );
  }
}
