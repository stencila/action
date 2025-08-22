// @ts-check

import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import fs from 'fs';
import path from 'path';

/**
 * @typedef {import('./types.d.ts').Context} Context
 * @typedef {import('./types.d.ts').ArtifactInfo} ArtifactInfo
 */

/**
 * Maximum file size for artifacts (500MB)
 */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/**
 * Maximum path length for artifacts
 */
const MAX_PATH_LENGTH = 260;

/**
 * Upload artifacts from workspace files
 * @param {Context} context - The context object to update
 * @returns {Promise<Context>} The context with populated artifact info
 */
async function uploadArtifacts(context) {
  if (!context.inputs) {
    throw new Error('Context must have inputs populated before uploading artifacts');
  }

  if (!context.results) {
    throw new Error('Context must have command results before uploading artifacts');
  }

  const { inputs } = context;
  const { assets: assetsPath, artifactName, workingDirectory } = inputs;

  // Only upload artifacts if assetsPath is specified and commands succeeded
  if (!assetsPath) {
    core.info('ℹ️ No assets path specified, skipping artifact upload');
    context.artifacts = [];
    return context;
  }

  const overallSuccess = context.results.every(r => r.exitCode === 0);
  if (!overallSuccess) {
    core.warning('⚠️ Skipping artifact upload due to command failures');
    context.artifacts = [];
    return context;
  }

  try {
    core.info(`🔍 Looking for files matching: ${assetsPath}`);

    // Create globber with the artifact path pattern
    const globber = await glob.create(
      path.join(workingDirectory, assetsPath),
      {
        followSymbolicLinks: false,
        implicitDescendants: false,
        omitBrokenSymbolicLinks: true
      }
    );

    const files = await globber.glob();
    const validatedFiles = await validateFiles(files, workingDirectory);

    if (validatedFiles.length === 0) {
      core.warning(`⚠️ No valid files found matching pattern: ${assetsPath}`);
      context.artifacts = [];
      return context;
    }

    core.info(`📁 Found ${validatedFiles.length} valid file(s) to upload`);

    // Create artifact client
    const artifactClient = new DefaultArtifactClient();

    // Upload the artifact with proper root directory
    const { id, size } = await artifactClient.uploadArtifact(
      artifactName,
      validatedFiles,
      path.resolve(workingDirectory),
      {
        retentionDays: 90,
        compressionLevel: 6
      }
    );

    const artifactInfo = {
      name: artifactName,
      files: validatedFiles.map(f => path.relative(workingDirectory, f)),
      size
    };

    context.artifacts = [artifactInfo];

    core.info(
      `✅ Successfully uploaded artifact '${artifactName}' (ID: ${id}, Size: ${formatBytes(size)}) with ${validatedFiles.length} file(s)`
    );

    return context;

  } catch (error) {
    core.warning(`⚠️ Failed to upload artifacts: ${error.message}`);
    context.artifacts = [];
    return context;
  }
}

/**
 * Validate files for artifact upload
 * @param {string[]} files - List of file paths to validate
 * @param {string} workingDirectory - Working directory for relative path calculation
 * @returns {Promise<string[]>} List of valid file paths
 */
async function validateFiles(files, workingDirectory) {
  const validFiles = [];
  let totalSize = 0;

  for (const filePath of files) {
    try {
      // Skip hidden files and directories (dot files)
      const relativePath = path.relative(workingDirectory, filePath);
      if (relativePath.split(path.sep).some(segment => segment.startsWith('.'))) {
        core.debug(`Skipping hidden file: ${relativePath}`);
        continue;
      }

      // Check if file exists and get stats
      const stats = fs.statSync(filePath);

      // Skip directories
      if (stats.isDirectory()) {
        core.debug(`Skipping directory: ${relativePath}`);
        continue;
      }

      // Validate path length
      if (filePath.length > MAX_PATH_LENGTH) {
        core.warning(`⚠️ Skipping file with path too long (${filePath.length} > ${MAX_PATH_LENGTH}): ${relativePath}`);
        continue;
      }

      // Validate file size
      if (stats.size > MAX_FILE_SIZE) {
        core.warning(`⚠️ Skipping file too large (${formatBytes(stats.size)} > ${formatBytes(MAX_FILE_SIZE)}): ${relativePath}`);
        continue;
      }

      // Check for reasonable total size (1GB limit for all files combined)
      totalSize += stats.size;
      if (totalSize > 1024 * 1024 * 1024) {
        core.warning('⚠️ Skipping remaining files - total size limit reached (1GB)');
        break;
      }

      validFiles.push(filePath);
      core.debug(`✅ Validated file: ${relativePath} (${formatBytes(stats.size)})`);

    } catch (error) {
      const relativePath = path.relative(workingDirectory, filePath);
      core.warning(`⚠️ Skipping file due to error: ${relativePath} - ${error.message}`);
    }
  }

  return validFiles;
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export { uploadArtifacts, validateFiles, formatBytes };