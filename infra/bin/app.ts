#!/usr/bin/env node
import 'source-map-support/register';
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { devConfig } from '../lib/config/dev';
import { prodConfig } from '../lib/config/prod';
import { SUPPORTED_REGION, validateConfig } from '../lib/config/env-config';
import { pipelineConfig, validatePipelineConfig } from '../lib/config/pipeline-config';
import { PipelineStack } from '../lib/stacks/pipeline-stack';
import packageJson from '../package.json';

// Único lugar donde se leen variables de entorno (BP-CDK-07).
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT no está definido: configura credenciales de AWS (aws sts get-caller-identity)');
}
if (region && region !== SUPPORTED_REGION) {
  throw new Error(`Región ${region} no permitida: el proyecto usa ${SUPPORTED_REGION}`);
}

const app = new App();
// cdk-nag sobre el PipelineStack; cada MallAgentsStage registra su propio plugin (BP-CDK-12).
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

new PipelineStack(app, 'PipelineStack', {
  env: { account, region: SUPPORTED_REGION },
  description: 'mall-agents: CI/CD con CDK Pipelines (CodePipeline V2 + CodeBuild ARM)',
  pipelineConfig: validatePipelineConfig(pipelineConfig),
  devConfig: validateConfig(devConfig(account)),
  prodConfig: validateConfig(prodConfig(account)),
  cdkCliVersion: packageJson.devDependencies['aws-cdk'],
});

app.synth();
