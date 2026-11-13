import { Match, Template } from 'aws-cdk-lib/assertions';
import { devConfig } from '../lib/config/dev';
import { prodConfig } from '../lib/config/prod';
import { PipelineStack } from '../lib/stacks/pipeline-stack';
import { resourcesOf, TEST_ACCOUNT, TEST_CONNECTION_ARN, testApp, testPipelineConfig } from './helpers';

function pipelineTemplate(prodEnabled = false): Template {
  const app = testApp();
  const stack = new PipelineStack(app, 'PipelineStack', {
    env: { account: TEST_ACCOUNT, region: 'us-east-2' },
    pipelineConfig: { ...testPipelineConfig, prodEnabled },
    devConfig: devConfig(TEST_ACCOUNT),
    prodConfig: prodConfig(TEST_ACCOUNT),
    cdkCliVersion: '2.1148.1',
  });
  return Template.fromStack(stack);
}

describe('PipelineStack', () => {
  const template = pipelineTemplate();

  test('CodePipeline V2 con stages Source, Build, UpdatePipeline, Assets y Dev', () => {
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      PipelineType: 'V2',
      Stages: [
        Match.objectLike({ Name: 'Source' }),
        Match.objectLike({ Name: 'Build' }),
        Match.objectLike({ Name: 'UpdatePipeline' }),
        Match.objectLike({ Name: 'Assets' }),
        Match.objectLike({ Name: 'Dev' }),
      ],
    });
  });

  test('una sola cuenta: sin clave KMS cross-account (BP-PIPE-11)', () => {
    template.resourceCountIs('AWS::KMS::Key', 0);
  });

  test('fuente: conexión de GitHub (CodeConnections) en main', () => {
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: Match.arrayWith([
        Match.objectLike({
          Name: 'Source',
          Actions: [
            Match.objectLike({
              ActionTypeId: Match.objectLike({ Provider: 'CodeStarSourceConnection' }),
              Configuration: Match.objectLike({
                ConnectionArn: TEST_CONNECTION_ARN,
                FullRepositoryId: 'cburibe/mall-agents-poc',
                BranchName: 'main',
              }),
            }),
          ],
        }),
      ]),
    });
  });

  test('todos los proyectos de CodeBuild: imagen ARM fijada, privileged y timeout de 30 min', () => {
    const projects = resourcesOf(template, 'AWS::CodeBuild::Project');
    expect(projects.length).toBeGreaterThanOrEqual(4);
    for (const project of projects) {
      expect(project.Properties['Environment']).toMatchObject({
        Image: 'aws/codebuild/amazonlinux-aarch64-standard:4.0',
        Type: 'ARM_CONTAINER',
        ComputeType: 'BUILD_GENERAL1_SMALL',
        PrivilegedMode: true,
      });
      expect(project.Properties['TimeoutInMinutes']).toBe(30);
    }
  });

  test('cada paso llama al Makefile (BP-PIPE-13)', () => {
    const synth = template.findResources('AWS::CodeBuild::Project', {
      Properties: { Description: Match.stringLikeRegexp('Synth') },
    });
    const buildspecs = JSON.stringify(template.findResources('AWS::CodeBuild::Project'));
    expect(Object.keys(synth)).toHaveLength(1);
    expect(buildspecs).toContain('make tools');
    expect(buildspecs).toContain('make ci');
    expect(buildspecs).toContain('make smoke ENV=dev');
  });

  test('validación de PR: CodeConnections y webhook anclado al actor y a main', () => {
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: Match.objectLike({
        Type: 'GITHUB',
        ReportBuildStatus: true,
        Auth: { Type: 'CODECONNECTIONS', Resource: TEST_CONNECTION_ARN },
      }),
      Triggers: {
        Webhook: true,
        FilterGroups: [
          [
            { Type: 'EVENT', Pattern: 'PULL_REQUEST_CREATED, PULL_REQUEST_UPDATED, PULL_REQUEST_REOPENED' },
            { Type: 'BASE_REF', Pattern: '^refs/heads/main$' },
            { Type: 'ACTOR_ACCOUNT_ID', Pattern: `^${testPipelineConfig.githubActorId}$` },
          ],
        ],
      },
    });
  });

  test('validación de PR: la política de la conexión existe antes del proyecto (CodeBuild valida GetConnection)', () => {
    template.hasResource('AWS::CodeBuild::Project', {
      Properties: { Source: Match.objectLike({ Type: 'GITHUB' }) },
      DependsOn: Match.arrayWith([Match.stringLikeRegexp('^PrValidationConnectionPolicy')]),
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: Match.arrayWith(['codeconnections:GetConnection', 'codeconnections:UseConnection']),
            Resource: TEST_CONNECTION_ARN,
          }),
        ],
      },
    });
  });

  test('validación de PR: solo puede asumir el rol de lookup (lectura), nunca el de deploy', () => {
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(policies).toContain(`role/cdk-hnb659fds-lookup-role-${TEST_ACCOUNT}-us-east-2`);
    const prPolicy = Object.entries(template.findResources('AWS::IAM::Policy')).find(([id]) =>
      id.startsWith('PrValidationProjectRoleDefaultPolicy'),
    );
    expect(prPolicy).toBeDefined();
    expect(JSON.stringify(prPolicy)).not.toContain('deploy-role');
  });

  test('smoke: permisos acotados al ambiente dev', () => {
    const smoke = Object.entries(template.findResources('AWS::IAM::Policy')).find(([id]) =>
      id.startsWith('PipelineDevSmokeDev'),
    );
    expect(smoke).toBeDefined();
    const doc = JSON.stringify(smoke);
    expect(doc).toContain('parameter/mall-agents/dev/*');
    expect(doc).toContain('secret:/mall-agents/dev/test-users/*');
    expect(doc).toContain('alias/mall-agents/dev');
    expect(doc).not.toContain('cloudformation:');
    expect(doc).not.toContain('deploy-role');
  });

  test('notificaciones: reglas de EventBridge a SNS con SSL obligatorio', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ detail: { state: ['FAILED'] } }),
    });
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  test('logs de CodeBuild con retención de 7 días', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });

  test('sin Prod mientras prodEnabled=false', () => {
    const stages = template.findResources('AWS::CodePipeline::Pipeline');
    expect(JSON.stringify(stages)).not.toContain('"Name":"Prod"');
  });
});

describe('PipelineStack con prod habilitado', () => {
  test('aprobación manual antes del Stage Prod (BP-PIPE-05)', () => {
    const template = pipelineTemplate(true);
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: Match.arrayWith([
        Match.objectLike({
          Name: 'Prod',
          Actions: Match.arrayWith([
            Match.objectLike({ Name: 'PromoverAProd', ActionTypeId: Match.objectLike({ Category: 'Approval' }) }),
          ]),
        }),
      ]),
    });
  });
});
