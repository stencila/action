// @ts-check

import * as core from "@actions/core";

/**
 * @typedef {import('./types.d.ts').Context} Context
 * @typedef {import('./types.d.ts').ActionInputs} ActionInputs
 */

/**
 * Parse and validate all action inputs
 * @param {Context} context - The context object to populate
 * @returns {Context} The context with populated inputs
 */
function parseInputs(context) {
  // Get raw inputs
  const version = core.getInput("version") || "latest";
  const run = core.getInput("run");
  const convert = core.getInput("convert");
  const lint = core.getInput("lint");
  const execute = core.getInput("execute");
  const render = core.getInput("render");
  const assets = core.getInput("assets");
  const releasesInput = core.getInput("releases");
  const releaseName = core.getInput("release-name");
  const releaseNotes = core.getInput("release-notes");
  const releaseFilenames = core.getInput("release-filenames");
  const workingDirectory = core.getInput("working-directory") || ".";
  const artifactName = core.getInput("artifact-name") || "assets";
  const cache = core.getBooleanInput("cache");
  const installTools = core.getBooleanInput("install-tools");
  const assumeAnswer = core.getInput("assume-answer") || "yes";
  const continueOnError = core.getBooleanInput("continue-on-error");

  // Parse releases input - can be boolean or string pattern
  /** @type {boolean | string} */
  let releases = false;
  if (releasesInput && releasesInput !== "false") {
    // It's either "true" or a glob pattern for release assets
    releases = releasesInput === "true" ? true : releasesInput;
  }

  // Normalize inputs first
  const inputs = {
    version: version.trim(),
    run: run ? run.trim() : "",
    convert: convert ? convert.trim() : "",
    lint: lint ? lint.trim() : "",
    execute: execute ? execute.trim() : "",
    render: render ? render.trim() : "",
    assets: assets ? assets.trim() : "",
    releases,
    releaseName: releaseName ? releaseName.trim() : "",
    releaseNotes: releaseNotes ? releaseNotes.trim() : "",
    releaseFilenames: releaseFilenames ? releaseFilenames.trim() : "",
    workingDirectory: workingDirectory.trim(),
    artifactName: artifactName.trim(),
    cache,
    installTools,
    assumeAnswer: assumeAnswer.trim().toLowerCase(),
    continueOnError
  };

  // Validate normalized inputs
  validateInputs(inputs);

  // Warn about deprecated inputs
  checkDeprecatedInputs(inputs);

  // Set inputs on context
  context.inputs = inputs;

  return context;
}

/**
 * Validate critical inputs
 * @param {Object} inputs - Inputs to validate
 * @throws {Error} If validation fails
 */
function validateInputs(inputs) {
  // Validate version format (allow 'latest' or semver-like patterns)
  if (inputs.version && inputs.version !== "latest") {
    const versionPattern = /^v?\d+\.\d+\.\d+(-.*)?$/;
    if (!versionPattern.test(inputs.version)) {
      throw new Error(
        `Invalid version format: ${inputs.version}. Use 'latest' or a version like 'v2.0.0'`
      );
    }
  }

  // Validate assume-answer value
  const validAnswers = ["yes", "no", "cancel"];
  if (inputs.assumeAnswer && !validAnswers.includes(inputs.assumeAnswer)) {
    throw new Error(
      `Invalid assume-answer value: ${inputs.assumeAnswer}. Must be one of: ${validAnswers.join(", ")}`
    );
  }

  // Validate artifact name (no special characters that could cause issues)
  if (inputs.artifactName) {
    const namePattern = /^[a-zA-Z0-9._-]+$/;
    if (!namePattern.test(inputs.artifactName)) {
      throw new Error(
        `Invalid artifact-name: ${inputs.artifactName}. Use only letters, numbers, dots, dashes, and underscores.`
      );
    }
  }

  // Validate working directory is not trying to escape
  if (inputs.workingDirectory && inputs.workingDirectory.includes("..")) {
    throw new Error(
      `Invalid working-directory: ${inputs.workingDirectory}. Path traversal not allowed.`
    );
  }
}

/**
 * Check for deprecated inputs and warn users
 * @param {ActionInputs} inputs - Parsed inputs
 */
function checkDeprecatedInputs(inputs) {
  // Add any deprecated input warnings here in the future
  // Example:
  // if (inputs.oldParam) {
  //   core.warning("The 'old-param' input is deprecated. Please use 'new-param' instead.");
  // }
  
  // Silence linter - function will use inputs parameter when deprecations are added
  void inputs;
}

export { parseInputs };