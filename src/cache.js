// @ts-check

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import fs from 'fs';
import path from 'path';

/**
 * @typedef {import('./types.d.ts').Context} Context
 */

/**
 * Restore Stencila cache if caching is enabled
 * @param {Context} context - The context object to update
 * @returns {Promise<Context>} The context with cache information
 */
async function restoreCache(context) {
  if (!context.inputs) {
    throw new Error('Context must have inputs populated before restoring cache');
  }

  if (!context.env) {
    throw new Error('Context must have environment populated before restoring cache');
  }

  if (!context.stencila) {
    throw new Error('Context must have Stencila info populated before restoring cache');
  }

  const { inputs, env, stencila } = context;
  const { workingDirectory, cache: useCache } = inputs;

  if (!useCache) {
    core.debug('📦 Cache disabled, skipping cache operations');
    return context;
  }

  try {
    // Generate cache key based on OS, Stencila version, and workflow file hash
    const { platform, arch } = env;
    const { resolvedVersion } = stencila;
    const cacheKey = `stencila-cache-${platform}-${arch}-${resolvedVersion}-${
      process.env.GITHUB_SHA || 'default'
    }`;
    const restoreKeys = [
      `stencila-cache-${platform}-${arch}-${resolvedVersion}-`,
      `stencila-cache-${platform}-${arch}-`,
    ];

    const stencilaCachePath = path.join(workingDirectory, '.stencila');

    core.info(`🔄 Restoring .stencila cache with key: ${cacheKey}`);
    const cacheHit = await cache.restoreCache(
      [stencilaCachePath],
      cacheKey,
      restoreKeys
    );

    if (cacheHit) {
      core.info(`✅ Cache restored from key: ${cacheHit}`);
    } else {
      core.info('ℹ️ No cache found, starting fresh');
    }

    // Store cache info in context for later save operation
    context.cache = {
      key: cacheKey,
      path: stencilaCachePath,
      wasRestored: !!cacheHit
    };

    return context;

  } catch (error) {
    core.warning(`⚠️ Failed to restore cache: ${error.message}`);
    return context;
  }
}

/**
 * Save Stencila cache if caching is enabled and commands were executed
 * @param {Context} context - The context object
 * @returns {Promise<Context>} The context unchanged
 */
async function saveCache(context) {
  if (!context.inputs) {
    throw new Error('Context must have inputs populated before saving cache');
  }

  const { inputs } = context;
  const { cache: useCache } = inputs;

  if (!useCache) {
    core.debug('📦 Cache disabled, skipping save');
    return context;
  }

  if (!context.cache) {
    core.debug('📦 No cache info available, skipping save');
    return context;
  }

  if (!context.results || context.results.length === 0) {
    core.debug('📦 No commands executed, skipping cache save');
    return context;
  }

  const { key: cacheKey, path: stencilaCachePath } = context.cache;

  if (!fs.existsSync(stencilaCachePath)) {
    core.debug(`📦 Cache path does not exist: ${stencilaCachePath}`);
    return context;
  }

  try {
    core.info(`💾 Saving .stencila cache with key: ${cacheKey}`);
    await cache.saveCache([stencilaCachePath], cacheKey);
    core.info('✅ Cache saved successfully');
  } catch (error) {
    if (
      error.name === 'ValidationError' &&
      error.message.includes('already exists')
    ) {
      core.info('ℹ️ Cache already exists, skipping save');
    } else {
      core.warning(`⚠️ Failed to save cache: ${error.message}`);
    }
  }

  return context;
}

export { restoreCache, saveCache };