import * as path from 'path';
import { Construct } from 'constructs';
import { CustomResource, Duration, RemovalPolicy, Stack, Validations } from 'aws-cdk-lib';
import { acknowledge, iam5Resource } from '../aspects/nag';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { UserGroup } from './cognito-auth';
import { PythonLambda } from './python-lambda';

export interface TestUser {
  readonly username: string;
  readonly group: UserGroup;
  /** Solo para roles con alcance de un mall (gerente_mall). */
  readonly mallId?: string;
}

/** Un usuario por rol para la demo (§15). Datos sintéticos. */
export const DEFAULT_TEST_USERS: readonly TestUser[] = [
  { username: 'visitante.demo', group: 'visitante' },
  { username: 'gerente.norte', group: 'gerente_mall', mallId: '1' },
  { username: 'analista.demo', group: 'analista' },
];

export function testUserSecretPrefix(envName: string): string {
  return `/mall-agents/${envName}/test-users/`;
}

export interface TestUsersProps {
  readonly envName: string;
  readonly userPool: cognito.IUserPool;
  readonly encryptionKey: kms.IKey;
  readonly removalPolicy: RemovalPolicy;
  readonly logRetentionDays: logs.RetentionDays;
  readonly users?: readonly TestUser[];
}

/**
 * Usuarios de prueba (solo dev). La contraseña la genera Secrets Manager y un custom resource
 * la fija como permanente con AdminSetUserPassword; nunca pasa por la plantilla ni por logs.
 */
export class TestUsers extends Construct {
  /** username → secreto con la contraseña. */
  public readonly secrets: Record<string, secretsmanager.Secret> = {};

  constructor(scope: Construct, id: string, props: TestUsersProps) {
    super(scope, id);
    const users = props.users ?? DEFAULT_TEST_USERS;

    const setter = new PythonLambda(this, 'PasswordSetter', {
      entry: path.join(__dirname, '..', '..', '..', 'functions', 'identity', 'seed_users'),
      serviceName: 'seed-test-users',
      description: 'Custom resource: fija la contraseña permanente de usuarios de prueba (dev)',
      logRetentionDays: props.logRetentionDays,
      removalPolicy: props.removalPolicy,
      timeout: Duration.seconds(30),
    });
    setter.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminSetUserPassword'],
        resources: [props.userPool.userPoolArn],
      }),
    );

    const providerLogGroup = new logs.LogGroup(this, 'ProviderLogGroup', {
      retention: props.logRetentionDays,
      removalPolicy: props.removalPolicy,
    });
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: setter.function,
      logGroup: providerLogGroup,
    });
    // Hallazgos del Provider framework de aws-cdk-lib (código del framework, no propio).
    const setterLogicalId = Stack.of(this).getLogicalId(setter.function.node.defaultChild as lambda.CfnFunction);
    acknowledge(provider, 'Runtime de la Lambda del Provider framework lo fija aws-cdk-lib', 'AwsSolutions-L1');
    acknowledge(
      provider,
      'Lambda del Provider framework de CDK: usa AWSLambdaBasicExecutionRole por diseño del framework',
      'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
    );
    acknowledge(
      provider,
      'Provider framework: lambda:InvokeFunction sobre las versiones (":*") del handler propio únicamente',
      iam5Resource(`<${setterLogicalId}.Arn>:*`),
    );

    for (const user of users) {
      const safeId = user.username.replace(/[^A-Za-z0-9]/g, '');

      const secret = new secretsmanager.Secret(this, `Password-${safeId}`, {
        // Nombre fijo con ambiente: el smoke test lo acota por prefijo (BP-CDK-09).
        secretName: `${testUserSecretPrefix(props.envName)}${user.username}`,
        description: `Contraseña del usuario de prueba ${user.username} (${props.envName})`,
        encryptionKey: props.encryptionKey,
        removalPolicy: props.removalPolicy,
        generateSecretString: {
          passwordLength: 24,
          requireEachIncludedType: true,
          excludeCharacters: '"\'\\`',
        },
      });
      Validations.of(secret).acknowledge({
        id: 'AwsSolutions-SMG4',
        reason: 'Credencial de usuario sintético solo en dev; rotación queda como mejora (prod)',
      });
      secret.grantRead(setter.role);
      this.secrets[user.username] = secret;

      const attributes: cognito.CfnUserPoolUser.AttributeTypeProperty[] = user.mallId
        ? [{ name: 'custom:mall_id', value: user.mallId }]
        : [];
      const cfnUser = new cognito.CfnUserPoolUser(this, `User-${safeId}`, {
        userPoolId: props.userPool.userPoolId,
        username: user.username,
        messageAction: 'SUPPRESS',
        userAttributes: attributes,
      });

      const membership = new cognito.CfnUserPoolUserToGroupAttachment(this, `Membership-${safeId}`, {
        userPoolId: props.userPool.userPoolId,
        username: user.username,
        groupName: user.group,
      });
      membership.addResourceDependency(cfnUser);

      const password = new CustomResource(this, `SetPassword-${safeId}`, {
        serviceToken: provider.serviceToken,
        resourceType: 'Custom::TestUserPassword',
        properties: {
          UserPoolId: props.userPool.userPoolId,
          Username: user.username,
          SecretArn: secret.secretArn,
        },
      });
      password.node.addDependency(cfnUser);
    }
  }
}
