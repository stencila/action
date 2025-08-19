# Stencila Action Architecture

## Overview

This document defines the internal architecture and contracts for the Stencila GitHub Action. It serves as the authoritative guide for module boundaries, data flow, and design decisions.

## Core Pipeline

The action follows a strict pipeline pattern where each stage receives and returns a `Context` object:

```javascript
parseInputs(context) →
resolveEnvironment(context) →
ensureStencila(context) →
runSteps(context) →
publishArtifacts(context) →
maybeCreateRelease(context)
```

## `Context` Object

All data flows through a single `Context` object that accumulates state through the pipeline:

```javascript
// @ts-check

/**
 * @typedef {Object} Context
 * @property {ActionInputs} inputs - Parsed and validated action inputs
 * @property {Environment} env - Platform and environment configuration
 * @property {StencilaInfo} stencila - Stencila binary information
 * @property {CommandResult[]} results - Results from executed commands
 * @property {string[]} artifacts - Files selected for artifact upload
 * @property {ReleaseInfo} release - Release metadata if applicable
 * @property {Errors} errors - Accumulated errors (for continue-on-error mode)
 */

/**
 * @typedef {Object} ActionInputs
 * @property {string} version - Stencila version to install
 * @property {string} run - Generic command to run
 * @property {string} convert - Convert command arguments
 * @property {string} lint - Lint command arguments
 * @property {string} execute - Execute command arguments
 * @property {string} render - Render command arguments
 * @property {string} assets - Glob pattern for artifacts
 * @property {string|boolean} releases - Release configuration
 * @property {string} releaseName - Template for release name
 * @property {string} releaseNotes - Template for release notes
 * @property {string} releaseFilenames - Template for asset renaming
 * @property {string} workingDirectory - Working directory
 * @property {string} artifactName - Name for uploaded artifact
 * @property {boolean} cache - Whether to use caching
 * @property {boolean} installTools - Whether to install tools
 * @property {string} assumeAnswer - Answer for prompts (yes/no/cancel)
 * @property {boolean} continueOnError - Continue on command failure
 */

/**
 * @typedef {Object} Environment
 * @property {string} platform - Node platform (linux/darwin/win32)
 * @property {string} arch - Node architecture (x64/arm64)
 * @property {string} platformString - Stencila platform string
 * @property {string} extension - Archive extension (tar.gz/zip)
 * @property {string} toolCachePath - Path to tool cache
 * @property {string} stencilaCachePath - Path to .stencila cache
 * @property {string} httpProxy - HTTP proxy if set
 * @property {string} httpsProxy - HTTPS proxy if set
 * @property {string} noProxy - No proxy list if set
 */

/**
 * @typedef {Object} StencilaInfo
 * @property {string} version - Resolved version (e.g., "v2.0.0")
 * @property {string} binaryPath - Full path to stencila binary
 * @property {boolean} wasAlreadyInstalled - Whether it was already on PATH
 * @property {string} downloadUrl - URL used for download (if downloaded)
 */

/**
 * @typedef {Object} CommandResult
 * @property {string} command - Command name (convert/lint/execute/render)
 * @property {string} args - Command arguments
 * @property {number} exitCode - Exit code from command
 * @property {string} stdout - Standard output
 * @property {string} stderr - Standard error
 * @property {number} duration - Execution time in milliseconds
 */

/**
 * @typedef {Object} ReleaseInfo
 * @property {boolean} shouldCreate - Whether to create a release
 * @property {string} tagName - Git tag name
 * @property {string} releaseName - Rendered release name
 * @property {string} releaseNotes - Rendered release notes
 * @property {string[]} assetPaths - Files to upload as assets
 * @property {Object<string,string>} assetRenames - Map of original to new names
 */
```

## Module Structure

### 1. `inputs.js`

**Responsibility:** Parse, validate, and normalize all action inputs

```javascript
/**
 * Parse and validate action inputs
 * @param {Context} context
 * @returns {Context} context with populated inputs
 */
function parseInputs(context)
```

#### Boundaries

- MUST NOT import any other module except `@actions/core`
- MUST validate all inputs and fail fast with clear messages
- MUST normalize paths, trim strings, parse booleans

### 2. `environment.js`

**Responsibility:** Detect platform, resolve paths, handle environment

```javascript
/**
 * Resolve environment configuration
 * @param {Context} context
 * @returns {Context} context with populated env
 */
function resolveEnvironment(context)
```

#### Boundaries

- MUST NOT import `stencila.js` or `runner.js`
- MAY import `@actions/tool-cache` for path resolution
- MUST handle proxy environment variables

### 3. `stencila.js`

**Responsibility:** Install and configure Stencila CLI

```javascript
/**
 * Ensure Stencila CLI is available
 * @param {Context} context
 * @returns {Context} context with populated stencila
 */
function ensureStencila(context)
```

#### Boundaries

- MUST use `@actions/tool-cache` for caching
- MUST verify checksums when downloading
- MUST NOT execute Stencila commands (that's `runner.js`)

### 4. `runner.js`

**Responsibility:** Execute Stencila commands

```javascript
/**
 * Run all configured Stencila commands
 * @param {Context} context
 * @returns {Context} context with populated results
 */
function runSteps(context)
```

#### Boundaries

- MUST use `@actions/exec` for command execution
- MUST NOT handle file uploads (that's `artifacts.js`)
- MUST respect `continueOnError` flag
- NO background processes allowed

### 5. `artifacts.js`

**Responsibility:** Upload workflow artifacts

```javascript
/**
 * Upload artifacts if configured
 * @param {Context} context
 * @returns {Context} context with populated artifacts
 */
function publishArtifacts(context)
```

#### Boundaries

- MUST use `@actions/artifact` for uploads
- MUST NOT create GitHub releases (that's `release.js`)

### 6. `release.js`

**Responsibility:** Create GitHub releases with assets

```javascript
/**
 * Create release if on tag
 * @param {Context} context
 * @returns {Context} context with populated release
 */
function maybeCreateRelease(context)
```

#### Boundaries

- MUST use `@actions/github` (octokit) for releases
- MUST NOT execute commands (that's `runner.js`)

### 7. `index.js`

**Responsibility:** Orchestrate the pipeline

```javascript
/**
 * Main entry point
 */
async function run() {
  const context = {};

  try {
    await core.group("Parse inputs", () => parseInputs(context));
    await core.group("Setup environment", () => resolveEnvironment(context));
    await core.group("Install Stencila", () => ensureStencila(context));
    await core.group("Run commands", () => runSteps(context));
    await core.group("Upload artifacts", () => publishArtifacts(context));
    await core.group("Create release", () => maybeCreateRelease(context));

    // Publish summary
    await publishSummary(context);
  } catch (error) {
    core.setFailed(error.message);
  }
}
```

#### Boundaries

- MUST NOT contain business logic (only orchestration)
- MUST use `core.group` for output organization
- MUST handle top-level errors

## Design Principles

### 1. Single Direction Data Flow

- `Context` flows in one direction through the pipeline
- No module calls "backwards" in the pipeline
- No shared global state

### 2. Fail Fast

- Validate inputs early and completely
- Provide clear, actionable error messages
- Don't continue if prerequisites aren't met (unless continueOnError)

### 3. No Side Effects

- Each function receives `Context`, modifies it, returns it
- No hidden state modifications
- No file system changes except through designated modules

### 4. Testability

- Each module exports pure functions
- Mock dependencies at module boundaries
- Test `Context` transformations

### 5. Security First

- Sanitize all inputs
- Use safe templating (no eval/code execution)
- Verify checksums
- Mask secrets in logs

## Migration Strategy

Using the Strangler Pattern, we'll gradually extract functionality:

1. Start with new `Context` object in existing index.js
2. Extract one module at a time
3. Route through new module while keeping old code
4. Remove old code once new module is stable
5. Repeat for each module

## Testing Requirements

### Unit Tests

Each module must have tests covering:

- Happy path
- Error conditions
- Edge cases
- `Context` transformations

### Integration Tests

- Full pipeline execution
- Cross-module interactions
- Platform-specific behavior
