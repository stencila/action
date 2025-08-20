// @ts-check

import * as core from "@actions/core";

/**
 * @typedef {import('./types.d.ts').Context} Context
 */

/**
 * Publish a summary of the action results
 * @param {Context} context - The context object with all operation results
 * @returns {Promise<Context>} The context unchanged
 */
async function publishSummary(context) {
  try {
    const summary = core.summary;
    
    // Start with heading
    summary.addHeading("📊 Stencila Action Results", 1);

    // Add setup section
    summary.addHeading("⚙️ Setup", 2);
    await addSetupInfo(summary, context);

    // Add commands section if any were executed
    if (context.results && context.results.length > 0) {
      summary.addHeading("🚀 Commands Executed", 2);
      addCommandsTable(summary, context);
    }

    // Add artifacts section if any were uploaded
    if (context.artifacts && context.artifacts.length > 0) {
      summary.addHeading("📦 Artifacts", 2);
      addArtifactsInfo(summary, context);
    }

    // Add release section if one was created
    if (context.release) {
      summary.addHeading("🏷️ Release", 2);
      addReleaseInfo(summary, context);
    }

    // Add any warnings or errors
    if (context.errors && context.errors.length > 0) {
      summary.addHeading("⚠️ Issues", 2);
      addErrorsInfo(summary, context);
    }

    // Write the summary
    await summary.write();
    
    return context;

  } catch (error) {
    // Don't fail the action if summary fails
    core.warning(`⚠️ Failed to publish summary: ${error.message}`);
    return context;
  }
}

/**
 * Add setup information to the summary
 * @param {any} summary - The summary builder
 * @param {Context} context - The context object
 */
async function addSetupInfo(summary, context) {
  const setupLines = [];

  // Stencila version info
  if (context.stencila) {
    const { resolvedVersion, wasAlreadyInstalled, installDuration } = context.stencila;
    const installStatus = wasAlreadyInstalled ? "🟢 Cached" : "🔵 Downloaded";
    const duration = installDuration ? ` (${(installDuration / 1000).toFixed(1)}s)` : "";
    setupLines.push(`**Stencila Version:** ${resolvedVersion} ${installStatus}${duration}`);
  }

  // Cache info
  if (context.cache) {
    const cacheStatus = context.cache.wasRestored ? "🟢 Hit" : "🟡 Miss";
    setupLines.push(`**Cache:** ${cacheStatus}`);
  }

  // Tools installation
  if (context.toolsInstalled) {
    const toolsStatus = context.toolsInstalled.success ? "✅ Success" : "❌ Failed";
    setupLines.push(`**Tools Installed:** ${toolsStatus}`);
  }

  // Environment info
  if (context.env) {
    const { platform, arch } = context.env;
    setupLines.push(`**Platform:** ${platform}-${arch}`);
  }

  if (setupLines.length > 0) {
    summary.addRaw(setupLines.join("\n"));
  } else {
    summary.addRaw("No setup information available.");
  }
}

/**
 * Add commands execution table to the summary
 * @param {any} summary - The summary builder
 * @param {Context} context - The context object
 */
function addCommandsTable(summary, context) {
  const tableHeaders = [
    { data: "Command", header: true },
    { data: "Status", header: true },
    { data: "Duration", header: true },
    { data: "Exit Code", header: true }
  ];

  const tableRows = [tableHeaders];

  for (const result of context.results) {
    const status = result.exitCode === 0 ? "✅ Success" : "❌ Failed";
    const duration = result.duration ? `${(result.duration / 1000).toFixed(1)}s` : "N/A";
    
    tableRows.push([
      { data: result.command, header: false },
      { data: status, header: false },
      { data: duration, header: false },
      { data: result.exitCode.toString(), header: false }
    ]);
  }

  summary.addTable(tableRows);

  // Add summary stats
  const totalCommands = context.results.length;
  const successCount = context.results.filter(r => r.exitCode === 0).length;
  const failedCount = totalCommands - successCount;
  
  if (failedCount > 0) {
    summary.addRaw(`\n**Summary:** ${successCount}/${totalCommands} commands succeeded, ${failedCount} failed.`);
  } else {
    summary.addRaw(`\n**Summary:** All ${totalCommands} commands succeeded! 🎉`);
  }
}

/**
 * Add artifacts information to the summary
 * @param {any} summary - The summary builder
 * @param {Context} context - The context object
 */
function addArtifactsInfo(summary, context) {
  const artifactLines = [];

  for (const artifact of context.artifacts) {
    const fileCount = artifact.files.length;
    const sizeFormatted = formatBytes(artifact.size);
    artifactLines.push(`**\`${artifact.name}\`:** ${fileCount} files, ${sizeFormatted}`);
  }

  summary.addRaw(artifactLines.join("\n"));
}

/**
 * Add release information to the summary
 * @param {any} summary - The summary builder
 * @param {Context} context - The context object
 */
function addReleaseInfo(summary, context) {
  const { release } = context;
  const releaseLines = [];

  releaseLines.push(`**Tag:** ${release.tag}`);
  releaseLines.push(`**Name:** ${release.name}`);
  
  if (release.prerelease) {
    releaseLines.push(`**Type:** 🚧 Pre-release`);
  } else {
    releaseLines.push(`**Type:** 🚀 Release`);
  }

  if (release.assets && release.assets.length > 0) {
    releaseLines.push(`**Assets:** ${release.assets.length} files uploaded`);
  }

  summary.addRaw(releaseLines.join("\n"));
}

/**
 * Add errors information to the summary
 * @param {any} summary - The summary builder
 * @param {Context} context - The context object
 */
function addErrorsInfo(summary, context) {
  const errorItems = [];

  for (const error of context.errors) {
    errorItems.push(`❌ ${error.message}`);
  }

  summary.addList(errorItems, false);
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

export { publishSummary, formatBytes };
