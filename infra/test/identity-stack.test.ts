import { Match, Template } from 'aws-cdk-lib/assertions';
import { devConfig } from '../lib/config/dev';
import { prodConfig } from '../lib/config/prod';
import { MallAgentsStage } from '../lib/stages/mall-agents-stage';
import { resourcesOf, TEST_ACCOUNT, testApp } from './helpers';

function identityTemplate(config = devConfig(TEST_ACCOUNT)) {
  const app = testApp();
  const stage = new MallAgentsStage(app, config.envName === 'dev' ? 'Dev' : 'Prod', { config });
  return { stack: stage.identity, template: Template.fromStack(stage.identity) };
}

describe('IdentityStack (dev)', () => {
  const { template, stack } = identityTemplate();

  test('User Pool sin auto-registro, ESSENTIALS y política de contraseñas fuerte', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UserPoolTier: 'ESSENTIALS',
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 14,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        }),
      },
    });
  });

  test('mall_id es atributo personalizado inmutable', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Schema: Match.arrayWith([Match.objectLike({ Name: 'mall_id', Mutable: false })]),
    });
  });

  test('Pre Token Generation V2_0 (claims en el access token)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreTokenGenerationConfig: { LambdaVersion: 'V2_0', LambdaArn: Match.anyValue() } },
    });
  });

  test('los cuatro grupos de roles existen', () => {
    for (const group of ['visitante', 'gerente_mall', 'analista', 'admin']) {
      template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: group });
    }
  });

  test('cliente web: sin secreto, solo SRP y sin escritura de atributos (anti cross-tenant)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web-dev',
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      WriteAttributes: [],
      AccessTokenValidity: 60,
    });
  });

  test('ningún cliente puede escribir atributos', () => {
    for (const client of resourcesOf(template, 'AWS::Cognito::UserPoolClient')) {
      expect(client.Properties['WriteAttributes']).toEqual([]);
    }
  });

  test('clientes M2M con client_credentials y scopes del resource server', () => {
    for (const name of ['orquestador-m2m-dev', 'locatarios-m2m-dev']) {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ClientName: name,
        GenerateSecret: true,
        AllowedOAuthFlows: ['client_credentials'],
        AllowedOAuthScopes: Match.arrayWith([
          { 'Fn::Join': ['', [Match.anyValue(), '/tools.read']] },
          { 'Fn::Join': ['', [Match.anyValue(), '/tools.write']] },
        ]),
      });
    }
    template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'mall-tools',
      Scopes: [Match.objectLike({ ScopeName: 'tools.read' }), Match.objectLike({ ScopeName: 'tools.write' })],
    });
  });

  test('CMK con rotación', () => {
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    template.hasResourceProperties('AWS::KMS::Alias', { AliasName: 'alias/mall-agents/dev' });
  });

  test('dev: sin AgentCore Memory mientras la cuenta lo tenga bloqueado (flag memory.enabled)', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::Memory', 0);
    expect(JSON.stringify(template.findResources('AWS::SSM::Parameter'))).not.toContain('memory/id');
  });

  test('con memory.enabled: Memory cifrada con la CMK, STM de 30 días, sin LTM y parámetro SSM', () => {
    const base = devConfig(TEST_ACCOUNT);
    const { template: withMemory } = identityTemplate({ ...base, memory: { ...base.memory, enabled: true } });
    withMemory.hasResourceProperties('AWS::SSM::Parameter', { Name: '/mall-agents/dev/memory/id' });
    withMemory.templateMatches({
      Resources: { AgentMemory1601EF79: Match.objectLike({ Type: 'AWS::BedrockAgentCore::Memory' }) },
    });
    withMemory.hasResourceProperties('AWS::BedrockAgentCore::Memory', {
      EventExpiryDuration: 30,
      EncryptionKeyArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Key'), 'Arn'] },
      MemoryStrategies: Match.absent(),
    });
  });

  test('todos los log groups con retención de 7 días', () => {
    const groups = resourcesOf(template, 'AWS::Logs::LogGroup');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.Properties['RetentionInDays']).toBe(7);
    }
  });

  test('Lambdas ARM64 con X-Ray y log group propio', () => {
    const functions = resourcesOf(template, 'AWS::Lambda::Function', { Properties: { Runtime: 'python3.12' } });
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn.Properties['Architectures']).toEqual(['arm64']);
      expect(fn.Properties['TracingConfig']).toEqual({ Mode: 'Active' });
      expect(fn.Properties['LoggingConfig']).toMatchObject({ LogGroup: expect.anything() as unknown });
    }
  });

  test('usuarios de prueba: tres, con grupo, sin email y contraseña desde Secrets Manager', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolUser', 3);
    template.hasResourceProperties('AWS::Cognito::UserPoolUser', {
      Username: 'gerente.norte',
      MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'custom:mall_id', Value: '1' }],
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolUserToGroupAttachment', {
      Username: 'gerente.norte',
      GroupName: 'gerente_mall',
    });
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: '/mall-agents/dev/test-users/gerente.norte',
      KmsKeyId: Match.anyValue(),
    });
    // La contraseña nunca viaja en la plantilla: el custom resource solo recibe el ARN del secreto.
    for (const resource of resourcesOf(template, 'Custom::TestUserPassword')) {
      expect(Object.keys(resource.Properties).sort()).toEqual(['SecretArn', 'ServiceToken', 'UserPoolId', 'Username']);
    }
  });

  test('el setter de contraseñas solo puede usar AdminSetUserPassword sobre este pool', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cognito-idp:AdminSetUserPassword',
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('^AuthUserPool'), 'Arn'] },
          }),
        ]),
      },
    });
  });

  test('parámetros SSM para consumidores fuera de CDK', () => {
    for (const name of ['cognito/user-pool-id', 'cognito/web-client-id', 'cognito/domain', 'region']) {
      template.hasResourceProperties('AWS::SSM::Parameter', { Name: `/mall-agents/dev/${name}` });
    }
  });

  test('dev: DESTROY en recursos stateful y sin protección de terminación', () => {
    template.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Delete' });
    template.hasResource('AWS::KMS::Key', { DeletionPolicy: 'Delete' });
    expect(stack.terminationProtection).toBe(false);
  });

  test('BP-CDK-04: logical IDs de recursos stateful estables', () => {
    template.templateMatches({
      Resources: {
        AuthUserPool8115E87F: Match.objectLike({ Type: 'AWS::Cognito::UserPool' }),
        Key961B73FD: Match.objectLike({ Type: 'AWS::KMS::Key' }),
      },
    });
  });

  test('etiquetas obligatorias en recursos etiquetables', () => {
    template.hasResourceProperties('AWS::KMS::Key', {
      // CloudFormation recibe las etiquetas ordenadas por clave.
      Tags: [
        { Key: 'cost-center', Value: Match.anyValue() },
        { Key: 'env', Value: 'dev' },
        { Key: 'owner', Value: Match.anyValue() },
        { Key: 'project', Value: 'mall-agents-poc' },
      ],
    });
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTags: Match.objectLike({ project: 'mall-agents-poc', env: 'dev' }),
    });
  });
});

describe('IdentityStack (prod)', () => {
  const { template, stack } = identityTemplate(prodConfig(TEST_ACCOUNT));

  test('RETAIN, protección de borrado y de terminación', () => {
    template.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    template.hasResourceProperties('AWS::Cognito::UserPool', { DeletionProtection: 'ACTIVE' });
    template.hasResource('AWS::KMS::Key', { DeletionPolicy: 'Retain' });
    expect(stack.terminationProtection).toBe(true);
  });

  test('sin usuarios de prueba y con tokens de 15 minutos', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolUser', 0);
    template.resourceCountIs('Custom::TestUserPassword', 0);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', { ClientName: 'web-prod', AccessTokenValidity: 15 });
  });
});
