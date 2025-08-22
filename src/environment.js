// @ts-check

import os from 'os';
import path from 'path';

/**
 * @typedef {import('./types.d.ts').Context} Context
 * @typedef {import('./types.d.ts').Environment} Environment
 */

/**
 * Resolve environment configuration
 * @param {Context} context - The context object to populate
 * @returns {Context} The context with populated env
 */
function resolveEnvironment(context) {
  const platform = os.platform();
  const arch = os.arch();

  // Determine Stencila platform string and archive extension
  const { platformString, extension } = getPlatformInfo(platform, arch);

  // Resolve cache paths
  const toolCachePath = getToolCachePath();
  const stencilaCachePath = getStencilaCachePath();

  // Get proxy settings from environment
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || '';
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';

  // Set environment on context
  context.env = {
    platform,
    arch,
    platformString,
    extension,
    toolCachePath,
    stencilaCachePath,
    httpProxy,
    httpsProxy,
    noProxy
  };

  return context;
}

/**
 * Get platform-specific information for Stencila
 * @param {string} platform - Node platform
 * @param {string} arch - Node architecture
 * @returns {{platformString: string, extension: string}} Platform info
 * @throws {Error} If platform/arch combination is not supported
 */
function getPlatformInfo(platform, arch) {
  let platformString;
  let extension = 'tar.gz';

  switch (platform) {
    case 'linux':
      if (arch === 'x64') {
        platformString = 'x86_64-unknown-linux-gnu';
      } else if (arch === 'arm64') {
        platformString = 'aarch64-unknown-linux-gnu';
      } else {
        throw new Error(`Unsupported Linux architecture: ${arch}`);
      }
      break;

    case 'darwin':
      if (arch === 'x64') {
        platformString = 'x86_64-apple-darwin';
      } else if (arch === 'arm64') {
        platformString = 'aarch64-apple-darwin';
      } else {
        throw new Error(`Unsupported macOS architecture: ${arch}`);
      }
      break;

    case 'win32':
      extension = 'zip';
      if (arch === 'x64') {
        platformString = 'x86_64-pc-windows-msvc';
      } else {
        throw new Error(`Unsupported Windows architecture: ${arch}`);
      }
      break;

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  return { platformString, extension };
}

/**
 * Get the tool cache path
 * @returns {string} Tool cache path
 */
function getToolCachePath() {
  // GitHub Actions sets RUNNER_TOOL_CACHE
  if (process.env.RUNNER_TOOL_CACHE) {
    return process.env.RUNNER_TOOL_CACHE;
  }

  // Fall back to temp directory for local testing
  return path.join(os.tmpdir(), 'tool-cache');
}

/**
 * Get the Stencila cache path
 * @returns {string} Stencila cache path
 */
function getStencilaCachePath() {
  // Check if STENCILA_CACHE_DIR is set
  if (process.env.STENCILA_CACHE_DIR) {
    return process.env.STENCILA_CACHE_DIR;
  }

  // Default to .stencila in home directory
  const homeDir = os.homedir();
  return path.join(homeDir, '.stencila');
}

export { resolveEnvironment, getPlatformInfo };