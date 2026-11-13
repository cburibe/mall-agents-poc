import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface PrValidationProps {
  readonly repo: string;
  readonly baseBranch: string;
  readonly connectionArn: string;
  readonly githubActorId: string;
  readonly buildEnvironment: codebuild.BuildEnvironment;
  readonly partialBuildSpec: Record<string, unknown>;
  readonly logGroup: logs.ILogGroup;
}

/**
 * Validación de PR (BP-PIPE-06): `make ci` + `cdk diff` contra dev, con estado reportado al PR.
 * Usa la misma CodeConnection que el pipeline (override L1 de Source.Auth, sin credencial de cuenta).
 * El webhook solo se dispara con PRs del actor configurado: en un repo público, un PR de terceros
 * no ejecuta builds con el rol de esta cuenta.
 */
export class PrValidation extends Construct {
  public readonly project: codebuild.Project;

  constructor(scope: Construct, id: string, props: PrValidationProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const [owner, repo] = props.repo.split('/') as [string, string];

    this.project = new codebuild.Project(this, 'Project', {
      description: 'Validación de PR: make ci + cdk diff (solo lectura)',
      source: codebuild.Source.gitHub({
        owner,
        repo,
        reportBuildStatus: true,
        webhook: true,
        webhookFilters: [
          codebuild.FilterGroup.inEventOf(
            codebuild.EventAction.PULL_REQUEST_CREATED,
            codebuild.EventAction.PULL_REQUEST_UPDATED,
            codebuild.EventAction.PULL_REQUEST_REOPENED,
          )
            // Los patrones son regex: se anclan para que un ID que contenga al nuestro no calce.
            .andBaseRefIs(`^refs/heads/${props.baseBranch}$`)
            .andActorAccountIs(`^${props.githubActorId}$`),
        ],
      }),
      environment: props.buildEnvironment,
      timeout: Duration.minutes(30),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER, codebuild.LocalCacheMode.CUSTOM),
      logging: { cloudWatch: { logGroup: props.logGroup } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        ...props.partialBuildSpec,
        phases: {
          ...(props.partialBuildSpec['phases'] as Record<string, unknown>),
          pre_build: { commands: ['make tools'] },
          build: { commands: ['make ci', 'make diff ENV=dev'] },
        },
        cache: { paths: ['/root/.npm/**/*', '/root/.cache/uv/**/*'] },
      }),
    });

    const cfnProject = this.project.node.defaultChild as codebuild.CfnProject;
    cfnProject.addPropertyOverride('Source.Auth', { Type: 'CODECONNECTIONS', Resource: props.connectionArn });

    // CodeBuild valida la conexión al CREAR el proyecto (GetConnection) con el rol del proyecto:
    // la política debe existir antes que el proyecto.
    const connectionPolicy = new iam.Policy(this, 'ConnectionPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            'codeconnections:GetConnection',
            'codeconnections:UseConnection',
            'codeconnections:GetConnectionToken',
            'codestar-connections:GetConnection',
            'codestar-connections:UseConnection',
          ],
          resources: [props.connectionArn],
        }),
      ],
    });
    if (this.project.role) connectionPolicy.attachToRole(this.project.role);
    cfnProject.addResourceDependency(connectionPolicy.node.defaultChild as iam.CfnPolicy);
    // Solo lectura: cdk diff asume el rol de lookup del bootstrap (ReadOnly), nunca el de deploy.
    this.project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:${stack.partition}:iam::${stack.account}:role/cdk-hnb659fds-lookup-role-${stack.account}-${stack.region}`,
        ],
      }),
    );
  }
}
