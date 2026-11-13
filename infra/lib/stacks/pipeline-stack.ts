import { Construct } from 'constructs';
import { ArnFormat, Aspects, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { EnvConfig } from '../config/env-config';
import { connectionArn, PipelineConfig } from '../config/pipeline-config';
import { applyMandatoryTags } from '../aspects/tagging';
import { acknowledge, acknowledgeCodeBuildDefaults, iam5Action, iam5Resource } from '../aspects/nag';
import { checkovSkip } from '../aspects/checkov';
import { LogRetentionCheck } from '../aspects/log-retention-check';
import { PrValidation } from '../constructs/pr-validation';
import { testUserSecretPrefix } from '../constructs/test-users';
import { MallAgentsStage } from '../stages/mall-agents-stage';

export interface PipelineStackProps extends StackProps {
  readonly pipelineConfig: PipelineConfig;
  readonly devConfig: EnvConfig;
  readonly prodConfig: EnvConfig;
  /** Versión de la CLI de CDK que usa el pipeline (= devDependency de infra/, BP-CDK-11). */
  readonly cdkCliVersion: string;
}

/**
 * CI/CD con CDK Pipelines (ADR-009). Se despliega una vez a mano; luego se auto-actualiza (BP-PIPE-01).
 * Cada paso llama a un objetivo del Makefile (BP-PIPE-13).
 */
export class PipelineStack extends Stack {
  public readonly pipeline: pipelines.CodePipeline;
  public readonly devStage: MallAgentsStage;
  public readonly notifications: sns.Topic;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const cfg = props.pipelineConfig;
    const dev = props.devConfig;
    const githubConnectionArn = connectionArn(cfg, this.account, this.region);

    const buildLogGroup = new logs.LogGroup(this, 'BuildLogs', {
      retention: dev.logRetentionDays,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const buildEnvironment: codebuild.BuildEnvironment = {
      buildImage: codebuild.LinuxArmBuildImage.fromCodeBuildImageId(cfg.buildImage),
      computeType: codebuild.ComputeType.SMALL,
      privileged: true, // Docker: bundling de PythonFunction e imágenes ARM64 de AgentCore.
    };
    const installPhase = {
      phases: {
        install: { 'runtime-versions': { nodejs: cfg.nodeVersion, python: cfg.pythonVersion } },
      },
    };

    const source = pipelines.CodePipelineSource.connection(cfg.repo, cfg.branch, {
      connectionArn: githubConnectionArn,
      triggerOnPush: true,
    });

    this.pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineType: codepipeline.PipelineType.V2,
      crossAccountKeys: false,
      selfMutation: true,
      publishAssetsInParallel: true,
      dockerEnabledForSynth: true,
      dockerEnabledForSelfMutation: true,
      cliVersion: props.cdkCliVersion,
      synth: new pipelines.CodeBuildStep('Synth', {
        input: source,
        installCommands: ['make tools'],
        commands: ['make ci'],
        primaryOutputDirectory: 'infra/cdk.out',
      }),
      codeBuildDefaults: {
        buildEnvironment,
        partialBuildSpec: codebuild.BuildSpec.fromObject(installPhase),
        timeout: Duration.minutes(30),
        cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER, codebuild.LocalCacheMode.CUSTOM),
        logging: { cloudWatch: { logGroup: buildLogGroup } },
      },
    });

    this.devStage = new MallAgentsStage(this, 'Dev', { config: dev });
    this.pipeline.addStage(this.devStage, {
      post: [this.smokeStep('SmokeDev', source, dev)],
    });

    if (cfg.prodEnabled) {
      this.pipeline.addStage(new MallAgentsStage(this, 'Prod', { config: props.prodConfig }), {
        pre: [
          new pipelines.ManualApprovalStep('PromoverAProd', {
            comment: 'Revisar el reporte de evaluación de dev antes de aprobar',
          }),
        ],
      });
    }

    this.pipeline.buildPipeline();

    new PrValidation(this, 'PrValidation', {
      repo: cfg.repo,
      baseBranch: cfg.branch,
      connectionArn: githubConnectionArn,
      githubActorId: cfg.githubActorId,
      buildEnvironment,
      partialBuildSpec: installPhase,
      logGroup: buildLogGroup,
    });

    // Notificaciones (BP-PIPE-12): EventBridge → SNS. AWS User Notifications está negado por la SCP del proyecto.
    this.notifications = new sns.Topic(this, 'PipelineNotifications', {
      displayName: 'mall-agents pipeline',
      enforceSSL: true,
    });
    const pipelineArn = this.pipeline.pipeline.pipelineArn;
    new events.Rule(this, 'PipelineFailed', {
      description: 'Ejecución del pipeline fallida',
      eventPattern: {
        source: ['aws.codepipeline'],
        detailType: ['CodePipeline Pipeline Execution State Change'],
        resources: [pipelineArn],
        detail: { state: ['FAILED'] },
      },
      targets: [new targets.SnsTopic(this.notifications)],
    });
    new events.Rule(this, 'ApprovalPending', {
      description: 'Aprobación manual pendiente',
      eventPattern: {
        source: ['aws.codepipeline'],
        detailType: ['CodePipeline Action Execution State Change'],
        resources: [pipelineArn],
        detail: { state: ['STARTED'], type: { category: ['Approval'] } },
      },
      targets: [new targets.SnsTopic(this.notifications)],
    });

    applyMandatoryTags(this, dev);
    Aspects.of(this).add(new LogRetentionCheck(dev.logRetentionDays));
    this.acknowledgeNagFindings(dev.envName);
  }

  /** Smoke de identidad post-deploy (BP-PIPE-04). Rol con solo lo que usa (BP-PIPE-07). */
  private smokeStep(id: string, source: pipelines.IFileSetProducer, config: EnvConfig): pipelines.CodeBuildStep {
    const prefix = `/mall-agents/${config.envName}`;
    return new pipelines.CodeBuildStep(id, {
      input: source,
      installCommands: ['make tools'],
      commands: [`make smoke ENV=${config.envName}`],
      rolePolicyStatements: [
        new iam.PolicyStatement({
          actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
          resources: [
            this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: prefix.slice(1) }),
            this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: `${prefix.slice(1)}/*` }),
          ],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            this.formatArn({
              service: 'secretsmanager',
              resource: 'secret',
              // El "*" cubre solo el sufijo aleatorio que Secrets Manager agrega al nombre.
              resourceName: `${testUserSecretPrefix(config.envName)}*`,
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
        new iam.PolicyStatement({
          actions: ['kms:Decrypt'],
          resources: [this.formatArn({ service: 'kms', resource: 'key', resourceName: '*' })],
          conditions: {
            StringEquals: { 'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com` },
            'ForAnyValue:StringEquals': { 'kms:ResourceAliases': `alias/mall-agents/${config.envName}` },
          },
        }),
        new iam.PolicyStatement({
          actions: ['cognito-idp:DescribeUserPoolClient'],
          resources: [this.formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: '*' })],
          conditions: {
            StringEquals: { 'aws:ResourceTag/env': config.envName, 'aws:ResourceTag/project': 'mall-agents-poc' },
          },
        }),
      ],
    });
  }

  /** Acknowledgments de cdk-nag (v3: una por hallazgo). Listadas en docs/SEGURIDAD.md (BP-CDK-12). */
  private acknowledgeNagFindings(envName: string): void {
    const { account, region } = this;
    const artifactBucket = this.pipeline.pipeline.artifactBucket;
    const bucketLogicalId = this.getLogicalId(artifactBucket.node.defaultChild as s3.CfnBucket);

    acknowledge(
      artifactBucket,
      'Bucket de artefactos del pipeline: solo artefactos de build efímeros; access logs como mejora (prod)',
      'AwsSolutions-S1',
    );
    acknowledge(
      this.pipeline,
      'Grants de CDK Pipelines sobre el bucket de artefactos propio (lectura/escritura de objetos del pipeline)',
      ...['s3:Abort*', 's3:DeleteObject*', 's3:GetBucket*', 's3:GetObject*', 's3:List*'].map(iam5Action),
      iam5Resource(`<${bucketLogicalId}.Arn>/*`),
    );
    acknowledge(
      this.pipeline,
      'Self-mutation de CDK Pipelines: asume los roles cdk-* del bootstrap (role/*) y lee CloudFormation/SSM del bootstrap (*); diseño del framework',
      iam5Resource(`arn:*:iam::${account}:role/*`),
      iam5Resource('*'),
    );
    acknowledge(
      this.pipeline,
      'Rol de publicación de assets de CDK Pipelines: comparte proyectos de CodeBuild por asset (logs/report groups de esos proyectos)',
      iam5Resource(`arn:aws:logs:${region}:${account}:log-group:/aws/codebuild/*`),
      iam5Resource(`arn:aws:codebuild:${region}:${account}:report-group/*`),
    );
    acknowledgeCodeBuildDefaults(
      this,
      'Artefactos y caché cifrados con la clave administrada de S3; una CMK por pipeline se omite por costo (crossAccountKeys: false, BP-PIPE-11)',
    );

    const prefix = `/mall-agents/${envName}`;
    acknowledge(
      this.pipeline,
      'Smoke: lectura de los parámetros SSM del ambiente (prefijo /mall-agents/<env>/)',
      iam5Resource(`arn:aws:ssm:${region}:${account}:parameter${prefix}/*`),
    );
    acknowledge(
      this.pipeline,
      'Smoke: el "*" cubre solo el sufijo aleatorio que Secrets Manager agrega a los secretos de usuarios de prueba',
      iam5Resource(`arn:aws:secretsmanager:${region}:${account}:secret:${testUserSecretPrefix(envName)}*`),
    );
    acknowledge(
      this.pipeline,
      'Smoke: kms:Decrypt condicionado a kms:ViaService=secretsmanager y al alias de la CMK del ambiente (la clave vive en otro stack)',
      iam5Resource(`arn:aws:kms:${region}:${account}:key/*`),
    );
    acknowledge(
      this.pipeline,
      'Smoke: DescribeUserPoolClient condicionado por etiquetas project/env (el pool vive en otro stack)',
      iam5Resource(`arn:aws:cognito-idp:${region}:${account}:userpool/*`),
    );
    acknowledge(
      this.notifications,
      'Notificaciones con nombre y estado del pipeline, sin datos sensibles; CMK omitida por costo',
      'AwsSolutions-SNS2',
    );

    // checkov: mismas decisiones, como metadata del recurso.
    checkovSkip(artifactBucket, 'CKV_AWS_18', 'Artefactos de build efímeros; access logs como mejora (prod)');
    checkovSkip(artifactBucket, 'CKV_AWS_21', 'Artefactos inmutables por ejecución; el historial vive en git');
    checkovSkip(this.notifications, 'CKV_AWS_26', 'Solo nombre/estado del pipeline; CMK omitida por costo');
    const assetFilePolicy = this.pipeline.node
      .findAll()
      .find((c): c is iam.CfnPolicy => c instanceof iam.CfnPolicy && c.node.path.includes('/Assets/FileRole/'));
    if (assetFilePolicy) {
      checkovSkip(
        assetFilePolicy,
        'CKV_AWS_111',
        'Rol de publicación de assets de CDK Pipelines: escribe en el bucket de assets del bootstrap (diseño del framework)',
      );
    }
  }
}
