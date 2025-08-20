// @ts-check

import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * @typedef {import('./types.d.ts').Context} Context
 */

/**
 * Install Stencila tools if requested
 * @param {Context} context - The context object to update
 * @returns {Promise<Context>} The context with tool installation results
 */
async function installTools(context) {
  if (!context.inputs) {
    throw new Error("Context must have inputs populated before installing tools");
  }

  const { inputs } = context;
  const { workingDirectory, installTools: shouldInstallTools, assumeAnswer } = inputs;

  if (!shouldInstallTools) {
    core.debug("🔧 Tool installation disabled, skipping");
    return context;
  }

  try {
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
      
      // Store tool installation result in context
      context.toolsInstalled = {
        success: false,
        exitCode: installExitCode
      };
    } else {
      core.info("✅ Tools installed successfully");
      
      // Store tool installation result in context
      context.toolsInstalled = {
        success: true,
        exitCode: 0
      };
    }

    return context;

  } catch (error) {
    core.warning(`⚠️ Error installing tools: ${error.message}`);
    
    // Store tool installation error in context
    context.toolsInstalled = {
      success: false,
      error: error.message
    };
    
    return context;
  }
}

export { installTools };