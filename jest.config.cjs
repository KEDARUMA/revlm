const path = require('path');

module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testTimeout: 20000,
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'esnext',
        moduleResolution: 'nodenext',
        esModuleInterop: true,
        isolatedModules: true
      },
      diagnostics: {
        ignoreCodes: [151002],
      }
    }],
  },
  testMatch: ['<rootDir>/packages/*/src/**/__tests__/**/*.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/packages/.*/dist/'],
  resolver: '<rootDir>/jest.resolver.cjs',
  moduleNameMapper: {
    '^@kedaruma/([^/]+)$': '<rootDir>/packages/$1/src/index.ts',
    '^@kedaruma/([^/]+)/(.+)$': '<rootDir>/packages/$1/src/$2.ts',
  },
};
