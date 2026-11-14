import { App, Aspects, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { LogRetentionCheck } from '../lib/aspects/log-retention-check';
import { devConfig } from '../lib/config/dev';
import { validateConfig } from '../lib/config/env-config';
import { connectionArn, pipelineConfig, validatePipelineConfig } from '../lib/config/pipeline-config';
import { prodConfig } from '../lib/config/prod';
import { TEST_ACCOUNT } from './helpers';

describe('validateConfig', () => {
  test('dev y prod válidos', () => {
    expect(() => validateConfig(devConfig(TEST_ACCOUNT))).not.toThrow();
    expect(() => validateConfig(prodConfig(TEST_ACCOUNT))).not.toThrow();
  });

  test('rechaza otra región (región fija del proyecto)', () => {
    expect(() => validateConfig({ ...devConfig(TEST_ACCOUNT), region: 'us-east-1' })).toThrow(/us-east-2/);
  });

  test('rechaza cuenta inválida', () => {
    expect(() => validateConfig(devConfig('abc'))).toThrow(/account/);
  });

  test('prod exige RETAIN, terminationProtection y sin usuarios de prueba', () => {
    const bad = {
      ...prodConfig(TEST_ACCOUNT),
      removalPolicy: RemovalPolicy.DESTROY,
      terminationProtection: false,
      cognito: { ...prodConfig(TEST_ACCOUNT).cognito, seedTestUsers: true },
    };
    expect(() => validateConfig(bad)).toThrow(/RETAIN[\s\S]*terminationProtection[\s\S]*usuarios de prueba/);
  });

  test('retención de logs fija en 7 días y memoria entre 7 y 365', () => {
    expect(() =>
      validateConfig({ ...devConfig(TEST_ACCOUNT), logRetentionDays: logs.RetentionDays.ONE_MONTH }),
    ).toThrow(/7/);
    expect(() =>
      validateConfig({ ...devConfig(TEST_ACCOUNT), memory: { enabled: true, expirationDays: 3, ltmEnabled: false } }),
    ).toThrow(/expirationDays/);
  });
});

describe('validatePipelineConfig', () => {
  test('config real válida y ARN armado con la cuenta resuelta (sin cuenta en el repo)', () => {
    expect(() => validatePipelineConfig(pipelineConfig)).not.toThrow();
    expect(connectionArn(pipelineConfig, TEST_ACCOUNT, 'us-east-2')).toBe(
      `arn:aws:codeconnections:us-east-2:${TEST_ACCOUNT}:connection/${pipelineConfig.connectionId}`,
    );
  });

  test('rechaza ARN de otra región o actor no numérico', () => {
    expect(() =>
      validatePipelineConfig({
        ...pipelineConfig,
        connectionId: 'no-es-un-uuid',
      }),
    ).toThrow(/connectionId/);
    expect(() => validatePipelineConfig({ ...pipelineConfig, githubActorId: 'cburibe' })).toThrow(/githubActorId/);
  });
});

describe('LogRetentionCheck', () => {
  function stackWith(retention: logs.RetentionDays): Stack {
    const stack = new Stack(new App(), 'Test');
    new logs.LogGroup(stack, 'Group', { retention });
    Aspects.of(stack).add(new LogRetentionCheck(7));
    return stack;
  }

  test('error si un log group no tiene retención', () => {
    Annotations.fromStack(stackWith(logs.RetentionDays.INFINITE)).hasError(
      '/Test/Group/Resource',
      Match.stringLikeRegexp('sin retención'),
    );
  });

  test('error si la retención no es la esperada', () => {
    Annotations.fromStack(stackWith(logs.RetentionDays.ONE_MONTH)).hasError(
      '/Test/Group/Resource',
      Match.stringLikeRegexp('Retención 30'),
    );
  });

  test('sin errores con 7 días', () => {
    Annotations.fromStack(stackWith(logs.RetentionDays.ONE_WEEK)).hasNoError('*', Match.anyValue());
  });
});
