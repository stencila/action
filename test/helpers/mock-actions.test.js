// @ts-check

import { describe, it, expect, vi } from 'vitest';
import {
  createCoreMock,
  createExecMock,
  createToolCacheMock,
  createGithubMock,
  createArtifactMock,
  createGlobMock,
  createTestContext
} from './mock-actions.js';

describe('Mock helpers', () => {
  describe('createCoreMock', () => {
    it('should create a mocked @actions/core module', () => {
      const mock = createCoreMock();
      
      expect(mock.getInput).toBeDefined();
      expect(mock.getInput('test')).toBe('');
      expect(mock.getInput).toHaveBeenCalledWith('test');
      
      expect(mock.getBooleanInput).toBeDefined();
      expect(mock.getBooleanInput('test')).toBe(false);
      
      expect(mock.summary.addHeading().write).toBeDefined();
    });
  });

  describe('createExecMock', () => {
    it('should create a mocked @actions/exec module', async () => {
      const mock = createExecMock();
      
      const result = await mock.exec('echo', ['test']);
      expect(result).toBe(0);
      expect(mock.exec).toHaveBeenCalledWith('echo', ['test']);
      
      const output = await mock.getExecOutput('ls');
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });
  });

  describe('createToolCacheMock', () => {
    it('should create a mocked @actions/tool-cache module', async () => {
      const mock = createToolCacheMock();
      
      const downloadPath = await mock.downloadTool('https://example.com/file');
      expect(downloadPath).toBe('/tmp/download');
      
      const extracted = await mock.extractTar('/tmp/file.tar.gz');
      expect(extracted).toBe('/tmp/extracted');
      
      const cached = await mock.cacheDir('/tmp/dir', 'stencila', 'v2.0.0');
      expect(cached).toBe('/tmp/dir');
      
      const found = mock.find('stencila', 'v2.0.0');
      expect(found).toBe('');
    });
  });

  describe('createGithubMock', () => {
    it('should create a mocked @actions/github module', async () => {
      const mock = createGithubMock();
      
      expect(mock.context.repo.owner).toBe('test-owner');
      expect(mock.context.repo.repo).toBe('test-repo');
      expect(mock.context.ref).toBe('refs/tags/v1.0.0');
      
      const octokit = mock.getOctokit('fake-token');
      const release = await octokit.rest.repos.createRelease({
        owner: 'test',
        repo: 'test',
        tag_name: 'v1.0.0'
      });
      
      expect(release.data.id).toBe(1);
      expect(release.data.upload_url).toBe('https://api.github.com/upload');
    });
  });

  describe('createArtifactMock', () => {
    it('should create a mocked @actions/artifact module', async () => {
      const mock = createArtifactMock();
      const client = new mock.DefaultArtifactClient();
      
      const result = await client.uploadArtifact('test', ['file.txt'], '/tmp');
      expect(result.artifactId).toBe('123');
      expect(result.artifactName).toBe('test-artifact');
      expect(result.size).toBe(1024);
    });
  });

  describe('createGlobMock', () => {
    it('should create a mocked @actions/glob module', async () => {
      const mock = createGlobMock();
      const globber = await mock.create('**/*.js');
      
      const files = await globber.glob();
      expect(Array.isArray(files)).toBe(true);
      expect(files).toEqual([]);
      
      const paths = globber.getSearchPaths();
      expect(Array.isArray(paths)).toBe(true);
    });
  });

  describe('createTestContext', () => {
    it('should create a test context with defaults', () => {
      const context = createTestContext();
      
      expect(context.inputs.version).toBe('latest');
      expect(context.inputs.cache).toBe(true);
      expect(context.inputs.releases).toBe(false);
      
      expect(context.env.platform).toBe('linux');
      expect(context.env.arch).toBe('x64');
      
      expect(context.stencila.version).toBe('v2.0.0');
      expect(context.results).toEqual([]);
      expect(context.artifacts).toEqual([]);
    });

    it('should allow overriding context properties', () => {
      const context = createTestContext({
        inputs: {
          version: 'v1.0.0',
          cache: false
        },
        env: {
          platform: 'darwin'
        },
        results: [
          { command: 'test', exitCode: 0 }
        ]
      });
      
      expect(context.inputs.version).toBe('v1.0.0');
      expect(context.inputs.cache).toBe(false);
      expect(context.inputs.releases).toBe(false); // Default preserved
      
      expect(context.env.platform).toBe('darwin');
      expect(context.env.arch).toBe('x64'); // Default preserved
      
      expect(context.results).toHaveLength(1);
      expect(context.results[0].command).toBe('test');
    });
  });
});