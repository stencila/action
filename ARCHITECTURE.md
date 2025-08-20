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

All data flows through a single `Context` object that accumulates state through the pipeline. See `types.d.ts`.

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
