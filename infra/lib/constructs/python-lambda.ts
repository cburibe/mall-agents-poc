import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { acknowledge, iam5Resource, XRAY_REASON } from '../aspects/nag';

export interface PythonLambdaProps {
  /** Directorio del paquete (pyproject.toml + uv.lock + handler.py). */
  readonly entry: string;
  readonly serviceName: string;
  readonly description: string;
  readonly logRetentionDays: logs.RetentionDays;
  readonly removalPolicy: RemovalPolicy;
  readonly timeout?: Duration;
  readonly memorySize?: number;
  readonly environment?: Record<string, string>;
  readonly reservedConcurrentExecutions?: number;
}

/**
 * Lambda Python estándar de la POC (BP-LMB-01/02, BP-PY-05):
 * ARM64, Python 3.12, uv.lock, Powertools, log group explícito con retención,
 * rol propio sin políticas administradas y X-Ray activo.
 */
export class PythonLambda extends Construct {
  public readonly function: PythonFunction;
  public readonly role: iam.Role;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: PythonLambdaProps) {
    super(scope, id);

    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: props.logRetentionDays,
      removalPolicy: props.removalPolicy,
    });

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Rol de ejecución de ${props.serviceName}`,
    });
    // Solo escribe en su propio log group (sin AWSLambdaBasicExecutionRole).
    this.logGroup.grantWrite(this.role);

    this.function = new PythonFunction(this, 'Function', {
      entry: props.entry,
      index: 'handler.py',
      handler: 'handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      description: props.description,
      role: this.role,
      logGroup: this.logGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      timeout: props.timeout ?? Duration.seconds(10),
      memorySize: props.memorySize ?? 256,
      tracing: lambda.Tracing.ACTIVE,
      reservedConcurrentExecutions: props.reservedConcurrentExecutions,
      bundling: {
        assetExcludes: ['tests', '.venv', '.mypy_cache', '.pytest_cache', '.ruff_cache', '__pycache__'],
      },
      environment: {
        POWERTOOLS_SERVICE_NAME: props.serviceName,
        POWERTOOLS_LOG_LEVEL: 'INFO',
        POWERTOOLS_METRICS_NAMESPACE: 'MallAgents',
        ...props.environment,
      },
    });
    // tracing ACTIVE agrega xray:PutTraceSegments/PutTelemetryRecords sobre "*".
    acknowledge(this.role, XRAY_REASON, iam5Resource('*'));
    acknowledge(
      this.function,
      'Python 3.12 en todo el repo (Lambdas, agentes, CodeBuild, uv); EOL de python3.12 en Lambda: 2028. Subir junto con el resto vía Dependabot/ADR',
      'AwsSolutions-L1',
    );
  }
}
