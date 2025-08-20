/**
 * @fileoverview TypeScript type definitions for Stencila Action
 * 
 * This file contains TypeScript interface definitions that provide
 * type checking for JavaScript files using @ts-check.
 */

export interface ActionInputs {
  version: string;
  run: string;
  convert: string;
  lint: string;
  execute: string;
  render: string;
  assets: string;
  releases: string | boolean;
  releaseName: string;
  releaseNotes: string;
  releaseFilenames: string;
  workingDirectory: string;
  artifactName: string;
  cache: boolean;
  installTools: boolean;
  assumeAnswer: string;
  continueOnError: boolean;
}

export interface Environment {
  platform: string;
  arch: string;
  platformString: string;
  extension: string;
  toolCachePath: string;
  stencilaCachePath: string;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

export interface StencilaInfo {
  version: string;
  resolvedVersion: string;
  binaryPath: string;
  wasAlreadyInstalled: boolean;
  downloadUrl: string;
  checksumVerified: boolean;
  installDuration: number;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface ArtifactInfo {
  name: string;
  files: string[];
  size: number;
}

export interface ReleaseInfo {
  id: number;
  tag: string;
  name: string;
  notes: string;
  prerelease: boolean;
  assets: string[];
}

export interface CacheInfo {
  key: string;
  path: string;
  wasRestored: boolean;
}

export interface ToolsInfo {
  success: boolean;
  exitCode?: number;
  error?: string;
}

export interface Context {
  inputs?: ActionInputs;
  env?: Environment;
  stencila?: StencilaInfo;
  results?: CommandResult[];
  artifacts?: ArtifactInfo[];
  release?: ReleaseInfo;
  cache?: CacheInfo;
  toolsInstalled?: ToolsInfo;
  errors?: Error[];
}