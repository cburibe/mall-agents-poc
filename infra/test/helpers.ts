import * as fs from 'fs';
import * as path from 'path';
import { App, Validations } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { PipelineConfig, pipelineConfig } from '../lib/config/pipeline-config';

export const TEST_ACCOUNT = '123456789012';

export interface SynthResource {
  readonly Properties: Record<string, unknown>;
}

/** findResources tipado (evita `any` en los tests). */
export function resourcesOf(template: Template, type: string, props?: Record<string, unknown>): SynthResource[] {
  return Object.values(template.findResources(type, props)) as SynthResource[];
}

/**
 * App de test: feature flags de cdk.json, sin bundling de Docker (rápido) y con cdk-nag activo, igual que bin/app.ts.
 * Si cdk-nag reporta un hallazgo sin acknowledgment, la síntesis falla y el test también.
 */
export function testApp(): App {
  // Mismos feature flags que el synth real (cdk.json), sin bundling.
  const cdkJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8')) as {
    context: Record<string, unknown>;
  };
  const app = new App({ context: { ...cdkJson.context, 'aws:cdk:bundling-stacks': [] } });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return app;
}

export const TEST_CONNECTION_ARN = `arn:aws:codeconnections:us-east-2:${TEST_ACCOUNT}:connection/11111111-2222-3333-4444-555555555555`;

export const testPipelineConfig: PipelineConfig = {
  ...pipelineConfig,
  connectionId: '11111111-2222-3333-4444-555555555555',
};
