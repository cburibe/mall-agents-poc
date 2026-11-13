/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  // Los tests sintetizan stacks con bundling de Docker (PythonFunction).
  testTimeout: 300000,
};
