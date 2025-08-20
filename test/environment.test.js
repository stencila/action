// @ts-check

import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resolveEnvironment, getPlatformInfo } from '../src/environment.js';

describe('environment.js', () => {
  let originalEnv;
  let originalPlatform;
  let originalArch;
  let originalHomedir;

  beforeEach(() => {
    // Save original values
    originalEnv = { ...process.env };
    originalPlatform = os.platform;
    originalArch = os.arch;
    originalHomedir = os.homedir;
  });

  afterEach(() => {
    // Restore original values
    process.env = originalEnv;
    os.platform = originalPlatform;
    os.arch = originalArch;
    os.homedir = originalHomedir;
  });

  describe('resolveEnvironment', () => {
    it('should resolve environment for Linux x64', () => {
      // Mock os functions
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      vi.spyOn(os, 'homedir').mockReturnValue('/home/user');

      const context = {};
      const result = resolveEnvironment(context);

      expect(result).toBe(context);
      expect(context.env).toBeDefined();
      expect(context.env.platform).toBe('linux');
      expect(context.env.arch).toBe('x64');
      expect(context.env.platformString).toBe('x86_64-unknown-linux-gnu');
      expect(context.env.extension).toBe('tar.gz');
      expect(context.env.stencilaCachePath).toBe('/home/user/.stencila');
    });

    it('should resolve environment for Linux arm64', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('arm64');
      vi.spyOn(os, 'homedir').mockReturnValue('/home/user');

      const context = {};
      resolveEnvironment(context);

      expect(context.env.platformString).toBe('aarch64-unknown-linux-gnu');
      expect(context.env.extension).toBe('tar.gz');
    });

    it('should resolve environment for macOS x64', () => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/user');

      const context = {};
      resolveEnvironment(context);

      expect(context.env.platform).toBe('darwin');
      expect(context.env.platformString).toBe('x86_64-apple-darwin');
      expect(context.env.extension).toBe('tar.gz');
      expect(context.env.stencilaCachePath).toBe('/Users/user/.stencila');
    });

    it('should resolve environment for macOS arm64', () => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      vi.spyOn(os, 'arch').mockReturnValue('arm64');

      const context = {};
      resolveEnvironment(context);

      expect(context.env.platformString).toBe('aarch64-apple-darwin');
      expect(context.env.extension).toBe('tar.gz');
    });

    it('should resolve environment for Windows x64', () => {
      vi.spyOn(os, 'platform').mockReturnValue('win32');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\user');

      const context = {};
      resolveEnvironment(context);

      expect(context.env.platform).toBe('win32');
      expect(context.env.platformString).toBe('x86_64-pc-windows-msvc');
      expect(context.env.extension).toBe('zip');
      expect(context.env.stencilaCachePath).toBe(path.join('C:\\Users\\user', '.stencila'));
    });

    it('should use RUNNER_TOOL_CACHE when available', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      
      process.env.RUNNER_TOOL_CACHE = '/actions/tool-cache';

      const context = {};
      resolveEnvironment(context);

      expect(context.env.toolCachePath).toBe('/actions/tool-cache');
    });

    it('should fall back to temp directory for tool cache', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      vi.spyOn(os, 'tmpdir').mockReturnValue('/tmp');
      
      delete process.env.RUNNER_TOOL_CACHE;

      const context = {};
      resolveEnvironment(context);

      expect(context.env.toolCachePath).toBe('/tmp/tool-cache');
    });

    it('should use STENCILA_CACHE_DIR when available', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      
      process.env.STENCILA_CACHE_DIR = '/custom/stencila-cache';

      const context = {};
      resolveEnvironment(context);

      expect(context.env.stencilaCachePath).toBe('/custom/stencila-cache');
    });

    it('should detect HTTP proxy settings', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      
      process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
      process.env.HTTPS_PROXY = 'https://proxy.example.com:8443';
      process.env.NO_PROXY = 'localhost,127.0.0.1';

      const context = {};
      resolveEnvironment(context);

      expect(context.env.httpProxy).toBe('http://proxy.example.com:8080');
      expect(context.env.httpsProxy).toBe('https://proxy.example.com:8443');
      expect(context.env.noProxy).toBe('localhost,127.0.0.1');
    });

    it('should detect lowercase proxy settings', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      
      process.env.http_proxy = 'http://proxy.example.com:8080';
      process.env.https_proxy = 'https://proxy.example.com:8443';
      process.env.no_proxy = 'localhost';

      const context = {};
      resolveEnvironment(context);

      expect(context.env.httpProxy).toBe('http://proxy.example.com:8080');
      expect(context.env.httpsProxy).toBe('https://proxy.example.com:8443');
      expect(context.env.noProxy).toBe('localhost');
    });

    it('should have empty proxy settings when not set', () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.spyOn(os, 'arch').mockReturnValue('x64');
      
      delete process.env.HTTP_PROXY;
      delete process.env.http_proxy;
      delete process.env.HTTPS_PROXY;
      delete process.env.https_proxy;
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;

      const context = {};
      resolveEnvironment(context);

      expect(context.env.httpProxy).toBe('');
      expect(context.env.httpsProxy).toBe('');
      expect(context.env.noProxy).toBe('');
    });
  });

  describe('getPlatformInfo', () => {
    it('should throw for unsupported Linux architecture', () => {
      expect(() => getPlatformInfo('linux', 'arm')).toThrow(
        'Unsupported Linux architecture: arm'
      );
    });

    it('should throw for unsupported macOS architecture', () => {
      expect(() => getPlatformInfo('darwin', 'arm')).toThrow(
        'Unsupported macOS architecture: arm'
      );
    });

    it('should throw for unsupported Windows architecture', () => {
      expect(() => getPlatformInfo('win32', 'arm64')).toThrow(
        'Unsupported Windows architecture: arm64'
      );
    });

    it('should throw for unsupported platform', () => {
      expect(() => getPlatformInfo('freebsd', 'x64')).toThrow(
        'Unsupported platform: freebsd'
      );
    });

    it('should return correct info for all supported platforms', () => {
      const cases = [
        {
          platform: 'linux',
          arch: 'x64',
          expected: {
            platformString: 'x86_64-unknown-linux-gnu',
            extension: 'tar.gz'
          }
        },
        {
          platform: 'linux',
          arch: 'arm64',
          expected: {
            platformString: 'aarch64-unknown-linux-gnu',
            extension: 'tar.gz'
          }
        },
        {
          platform: 'darwin',
          arch: 'x64',
          expected: {
            platformString: 'x86_64-apple-darwin',
            extension: 'tar.gz'
          }
        },
        {
          platform: 'darwin',
          arch: 'arm64',
          expected: {
            platformString: 'aarch64-apple-darwin',
            extension: 'tar.gz'
          }
        },
        {
          platform: 'win32',
          arch: 'x64',
          expected: {
            platformString: 'x86_64-pc-windows-msvc',
            extension: 'zip'
          }
        }
      ];

      for (const testCase of cases) {
        const result = getPlatformInfo(testCase.platform, testCase.arch);
        expect(result).toEqual(testCase.expected);
      }
    });
  });
});