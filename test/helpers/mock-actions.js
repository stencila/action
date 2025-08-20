// @ts-check

import { vi } from 'vitest';

/**
 * Create mocked @actions/core module
 * @returns {Object} Mocked core module
 */
export function createCoreMock() {
  // Store input values for both getInput and getBooleanInput to use
  const inputValues = new Map();
  
  const mockGetInput = vi.fn((name) => {
    return inputValues.get(name) || '';
  });
  
  const mockGetBooleanInput = vi.fn((name) => {
    const value = inputValues.get(name) || '';
    // Parse YAML boolean values according to YAML 1.2 Core Schema
    const trueValues = ['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 'y', 'Y', 'on', 'On', 'ON'];
    const falseValues = ['false', 'False', 'FALSE', 'no', 'No', 'NO', 'n', 'N', 'off', 'Off', 'OFF'];
    
    if (trueValues.includes(value)) {
      return true;
    } else if (falseValues.includes(value) || value === '') {
      return false; // Default to false for empty strings and explicit false values
    } else {
      throw new TypeError(`Input does not meet YAML 1.2 "Core Schema" specification: ${name}\nSupport boolean input list: \`true | True | TRUE | false | False | FALSE\``);
    }
  });
  
  // Create a mock object with helpers
  const mock = {
    getInput: mockGetInput,
    getBooleanInput: mockGetBooleanInput,
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    group: vi.fn(async (name, fn) => fn()),
    startGroup: vi.fn(),
    endGroup: vi.fn(),
    exportVariable: vi.fn(),
    setSecret: vi.fn(),
    addPath: vi.fn(),
    summary: {
      addHeading: vi.fn().mockReturnThis(),
      addTable: vi.fn().mockReturnThis(),
      addRaw: vi.fn().mockReturnThis(),
      write: vi.fn()
    },
    // Helper method to set input values
    setInputValue: (name, value) => {
      inputValues.set(name, value);
    },
    // Helper method to clear all input values
    clearInputValues: () => {
      inputValues.clear();
    }
  };
  
  return mock;
}

/**
 * Create mocked @actions/exec module
 * @returns {Object} Mocked exec module
 */
export function createExecMock() {
  return {
    exec: vi.fn(async () => 0),
    getExecOutput: vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: ''
    }))
  };
}

/**
 * Create mocked @actions/tool-cache module
 * @returns {Object} Mocked tool-cache module
 */
export function createToolCacheMock() {
  return {
    downloadTool: vi.fn(async (url) => '/tmp/download'),
    extractTar: vi.fn(async (file) => '/tmp/extracted'),
    extractZip: vi.fn(async (file) => '/tmp/extracted'),
    cacheDir: vi.fn(async (dir, tool, version) => dir),
    find: vi.fn((tool, version) => ''),
    findAllVersions: vi.fn((tool) => [])
  };
}

/**
 * Create mocked @actions/github module
 * @returns {Object} Mocked github module
 */
export function createGithubMock() {
  const context = {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo'
    },
    ref: 'refs/tags/v1.0.0',
    sha: 'abc123',
    eventName: 'push',
    workflow: 'test-workflow',
    runId: 123,
    runNumber: 456
  };

  const octokit = {
    rest: {
      repos: {
        createRelease: vi.fn(async () => ({
          data: { 
            id: 1,
            upload_url: 'https://api.github.com/upload'
          }
        })),
        uploadReleaseAsset: vi.fn(async () => ({
          data: { id: 2 }
        })),
        listReleases: vi.fn(async () => ({
          data: []
        }))
      }
    }
  };

  return {
    context,
    getOctokit: vi.fn(() => octokit)
  };
}

/**
 * Create mocked @actions/artifact module
 * @returns {Object} Mocked artifact module
 */
export function createArtifactMock() {
  const client = {
    uploadArtifact: vi.fn(async () => ({
      artifactId: '123',
      artifactName: 'test-artifact',
      size: 1024
    }))
  };

  return {
    DefaultArtifactClient: vi.fn(() => client)
  };
}

/**
 * Create mocked @actions/glob module
 * @returns {Object} Mocked glob module
 */
export function createGlobMock() {
  const globber = {
    glob: vi.fn(async () => []),
    getSearchPaths: vi.fn(() => []),
    globGenerator: vi.fn(async function* () {})
  };

  return {
    create: vi.fn(async () => globber)
  };
}

/**
 * Create test context object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Test context
 */
export function createTestContext(overrides = {}) {
  return {
    inputs: {
      version: 'latest',
      run: '',
      convert: '',
      lint: '',
      execute: '',
      render: '',
      assets: '',
      releases: false,
      releaseName: '',
      releaseNotes: '',
      releaseFilenames: '',
      workingDirectory: '.',
      artifactName: 'assets',
      cache: true,
      installTools: false,
      assumeAnswer: 'yes',
      continueOnError: false,
      ...overrides.inputs
    },
    env: {
      platform: 'linux',
      arch: 'x64',
      platformString: 'x86_64-unknown-linux-gnu',
      extension: 'tar.gz',
      toolCachePath: '/tmp/tool-cache',
      stencilaCachePath: '/tmp/.stencila',
      httpProxy: '',
      httpsProxy: '',
      noProxy: '',
      ...overrides.env
    },
    stencila: {
      version: 'v2.0.0',
      binaryPath: '/usr/local/bin/stencila',
      wasAlreadyInstalled: false,
      downloadUrl: '',
      ...overrides.stencila
    },
    results: overrides.results || [],
    artifacts: overrides.artifacts || [],
    release: overrides.release || null,
    errors: overrides.errors || []
  };
}