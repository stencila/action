import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import fs from "fs";
import path from "path";

// Import new modules (strangler pattern - gradual migration)
import { parseInputs } from "./inputs.js";
import { resolveEnvironment } from "./environment.js";
import { ensureStencila } from "./stencila.js";
import { runCommands } from "./runner.js";
import { uploadArtifacts } from "./artifacts.js";
import { createRelease } from "./release.js";

async function run() {
  try {
    // Initialize context object
    const context = {};
    
    // Phase 1: Use new modules for input parsing and environment resolution
    await core.group("Parse inputs", () => parseInputs(context));
    await core.group("Setup environment", () => resolveEnvironment(context));
    
    // Phase 2: Use new stencila module for installation
    await core.group("Install Stencila", () => ensureStencila(context));
    
    // Extract values from context for backward compatibility with existing code
    const { inputs, env } = context;
    const { workingDirectory, useCache, installTools, assumeAnswer } = inputs;

    // Cache restoration logic
    const stencilaCachePath = path.join(workingDirectory, ".stencila");
    let cacheKey = "";

    if (useCache) {
      // Generate cache key based on OS, Stencila version, and workflow file hash
      const { platform, arch } = env;
      const { resolvedVersion } = context.stencila;
      cacheKey = `stencila-cache-${platform}-${arch}-${resolvedVersion}-${
        process.env.GITHUB_SHA || "default"
      }`;
      const restoreKeys = [
        `stencila-cache-${platform}-${arch}-${resolvedVersion}-`,
        `stencila-cache-${platform}-${arch}-`,
      ];

      try {
        core.info(`🔄 Restoring .stencila cache with key: ${cacheKey}`);
        const cacheHit = await cache.restoreCache(
          [stencilaCachePath],
          cacheKey,
          restoreKeys
        );

        if (cacheHit) {
          core.info(`✅ Cache restored from key: ${cacheHit}`);
        } else {
          core.info("ℹ️ No cache found, starting fresh");
        }
      } catch (error) {
        core.warning(`⚠️ Failed to restore cache: ${error.message}`);
      }
    }

    // Install tools if requested
    if (installTools) {
      core.info("🔧 Installing Stencila tools...");
      const installExitCode = await exec.exec(
        "stencila",
        ["tools", "install", `--${assumeAnswer}`],
        {
          cwd: workingDirectory,
          ignoreReturnCode: true,
        }
      );

      if (installExitCode !== 0) {
        core.warning(
          `⚠️ Failed to install tools with exit code ${installExitCode}`
        );
      } else {
        core.info("✅ Tools installed successfully");
      }
    }

    // Phase 3: Use new runner module for command execution
    await core.group("Run commands", () => runCommands(context));

    // Extract results for backward compatibility (kept for potential future use)

    // Save cache after command execution
    if (useCache && context.results && context.results.length > 0 && fs.existsSync(stencilaCachePath)) {
      try {
        core.info(`💾 Saving .stencila cache with key: ${cacheKey}`);
        await cache.saveCache([stencilaCachePath], cacheKey);
      } catch (error) {
        if (
          error.name === "ValidationError" &&
          error.message.includes("already exists")
        ) {
          core.info("ℹ️ Cache already exists, skipping save");
        } else {
          core.warning(`⚠️ Failed to save cache: ${error.message}`);
        }
      }
    }

    // Phase 4a: Use new artifacts module for artifact upload
    await core.group("Upload artifacts", () => uploadArtifacts(context));

    // Phase 4b: Use new release module for GitHub releases
    await core.group("Create release", () => createRelease(context));
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
