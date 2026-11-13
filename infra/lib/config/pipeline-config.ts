export interface PipelineConfig {
  /** owner/repo en GitHub. */
  readonly repo: string;
  readonly branch: string;
  /**
   * ID (UUID) de la conexión de CodeConnections creada a mano en la consola (ver RUNBOOK).
   * El ARN se arma con la cuenta resuelta al sintetizar: así el número de cuenta no queda en el repo público.
   */
  readonly connectionId: string;
  /** ID numérico de GitHub del único actor que puede disparar la validación de PR. */
  readonly githubActorId: string;
  /** Agrega ManualApprovalStep + Stage Prod. En la POC queda en false (P2). */
  readonly prodEnabled: boolean;
  /** Imagen ARM de CodeBuild fijada (BP-PIPE-09). */
  readonly buildImage: string;
  readonly nodeVersion: string;
  readonly pythonVersion: string;
}

export const pipelineConfig: PipelineConfig = {
  repo: 'cburibe/mall-agents-poc',
  branch: 'main',
  connectionId: 'a1165e30-b62f-4564-a41e-00634beca392',
  githubActorId: '91168213',
  prodEnabled: false,
  buildImage: 'aws/codebuild/amazonlinux-aarch64-standard:4.0',
  nodeVersion: '22',
  pythonVersion: '3.12',
};

export function validatePipelineConfig(config: PipelineConfig): PipelineConfig {
  const errors: string[] = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repo)) errors.push(`repo inválido: ${config.repo}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(config.connectionId)) {
    errors.push(`connectionId inválido (se espera un UUID): ${config.connectionId}`);
  }
  if (!/^\d+$/.test(config.githubActorId)) errors.push('githubActorId debe ser numérico');
  if (errors.length > 0) throw new Error(`PipelineConfig inválida:\n - ${errors.join('\n - ')}`);
  return config;
}

export function connectionArn(config: PipelineConfig, account: string, region: string): string {
  return `arn:aws:codeconnections:${region}:${account}:connection/${config.connectionId}`;
}
