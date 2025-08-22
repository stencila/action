import * as core from '@actions/core';

import { parseInputs } from './inputs.js';
import { resolveEnvironment } from './environment.js';
import { ensureStencila } from './stencila.js';
import { restoreCache, saveCache } from './cache.js';
import { installTools } from './tools.js';
import { runCommands } from './runner.js';
import { uploadArtifacts } from './artifacts.js';
import { createRelease } from './release.js';
import { publishSummary } from './summary.js';

async function run() {
  try {
    const context = {};
    await core.group('Parse inputs', () => parseInputs(context));
    await core.group('Setup environment', () => resolveEnvironment(context));
    await core.group('Install Stencila', () => ensureStencila(context));
    await core.group('Restore cache', () => restoreCache(context));
    await core.group('Install tools', () => installTools(context));
    await core.group('Run commands', () => runCommands(context));
    await core.group('Save cache', () => saveCache(context));
    await core.group('Upload artifacts', () => uploadArtifacts(context));
    await core.group('Create release', () => createRelease(context));
    await publishSummary(context);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
