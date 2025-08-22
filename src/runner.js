// @ts-check

import * as core from '@actions/core';
import * as exec from '@actions/exec';

/**
 * @typedef {import('./types.d.ts').Context} Context
 * @typedef {import('./types.d.ts').CommandResult} CommandResult
 */



/**
 * Secrets that should be masked in output
 */
const SECRET_PATTERNS = [
  /GITHUB_TOKEN\s*=\s*\S+/gi,
  /API_KEY\s*=\s*\S+/gi,
  /PASSWORD\s*=\s*\S+/gi,
  /\b\w*SECRET\w*\s*=\s*\S+/gi,
  /\b\w*TOKEN\w*\s*=\s*\S+/gi,
  /\b\w*KEY\w*\s*=\s*\S+/gi
];

/**
 * Run Stencila commands with proper logging, timeouts, and error handling
 * @param {Context} context - The context object to update
 * @returns {Promise<Context>} The context with populated command results
 */
async function runCommands(context) {
  if (!context.inputs) {
    throw new Error('Context must have inputs populated before running commands');
  }

  if (!context.stencila) {
    throw new Error('Context must have stencila info populated before running commands');
  }

  const { inputs } = context;
  const { workingDirectory, continueOnError, assumeAnswer } = inputs;

  // Collect all commands to run
  const commandsToRun = collectCommands(inputs);

  if (commandsToRun.length === 0) {
    core.info('ℹ️ No commands to run');
    context.results = [];
    return context;
  }

  const results = [];
  let overallSuccess = true;

  core.info(`⚡ Executing ${commandsToRun.length} command(s)...`);

  for (let i = 0; i < commandsToRun.length; i++) {
    const command = commandsToRun[i];
    const startTime = Date.now();

    core.info(`⚡ Running command ${i + 1}/${commandsToRun.length}: stencila ${command.command} ${command.args || ''}`);

    try {
      const result = await executeCommand(command, workingDirectory, assumeAnswer);
      const duration = Date.now() - startTime;

      const commandResult = {
        command: `stencila ${command.command} ${command.args || ''}`.trim(),
        exitCode: result.exitCode,
        duration
      };

      results.push(commandResult);

      if (result.exitCode === 0) {
        core.info(`✅ Command ${i + 1} completed successfully (${duration}ms)`);
      } else {
        overallSuccess = false;
        core.error(`❌ Command ${i + 1} failed with exit code ${result.exitCode} (${duration}ms)`);

        if (!continueOnError) {
          core.setFailed(`Stencila command failed with exit code ${result.exitCode}`);
          break;
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      overallSuccess = false;

      const commandResult = {
        command: `stencila ${command.command} ${command.args || ''}`.trim(),
        exitCode: -1,
        duration
      };

      results.push(commandResult);

      core.error(`❌ Command ${i + 1} failed with error: ${error.message} (${duration}ms)`);

      if (!continueOnError) {
        throw error;
      }
    }
  }

  // Set final exit code to the last command's exit code
  const lastResult = results[results.length - 1];
  if (lastResult) {
    core.setOutput('exit-code', lastResult.exitCode.toString());
  }

  // If continue-on-error is true and any command failed, still fail the action at the end
  if (!overallSuccess && continueOnError) {
    core.setFailed('One or more Stencila commands failed');
  }

  context.results = results;
  return context;
}

/**
 * Collect commands from inputs
 * @param {import('./types.d.ts').ActionInputs} inputs - Action inputs
 * @returns {Array<{command: string, args: string}>} Commands to run
 */
function collectCommands(inputs) {
  const commandsToRun = [];

  // Parse run input if provided
  if (inputs.run) {
    const cmdParts = inputs.run.trim().split(/\s+/);
    commandsToRun.push({
      command: cmdParts[0],
      args: cmdParts.slice(1).join(' ')
    });
  }

  // Check for simplified command syntax
  const commands = ['convert', 'lint', 'execute', 'render'];
  for (const cmdName of commands) {
    const cmdArgs = inputs[cmdName];
    if (cmdArgs) {
      // Special handling for render command to support multi-line inputs
      if (cmdName === 'render') {
        const renderCommands = cmdArgs
          .split('\\n')
          .filter(/** @param {string} line */ (line) => line.trim())
          .map(/** @param {string} args */ (args) => ({
            command: cmdName,
            args
          }));
        commandsToRun.push(...renderCommands);
      } else {
        // Other commands use the input as is
        commandsToRun.push({
          command: cmdName,
          args: cmdArgs
        });
      }
    }
  }

  return commandsToRun;
}

/**
 * Execute a single Stencila command
 * @param {{command: string, args: string}} commandSpec - Command specification
 * @param {string} workingDirectory - Working directory for execution
 * @param {string} assumeAnswer - Assume answer for prompts
 * @returns {Promise<{exitCode: number}>} Execution result
 */
async function executeCommand(commandSpec, workingDirectory, assumeAnswer) {
  const { command, args } = commandSpec;
  const cmdArgs = args ? args.split(' ') : [];
  const fullArgs = [command, ...cmdArgs, `--${assumeAnswer}`];

  // Execute command with environment variables to encourage human-readable output
  const exitCode = await exec.exec('stencila', fullArgs, {
    cwd: workingDirectory,
    ignoreReturnCode: true,
    env: {
      ...process.env,
      // Force TTY-like behavior
      FORCE_COLOR: 'true',
      NO_COLOR: undefined
    }
  });

  return { exitCode };
}

/**
 * Mask secrets in output strings
 * @param {string} text - Text to mask
 * @returns {string} Text with secrets masked
 */
function maskSecrets(text) {
  let maskedText = text;

  // Mask known secret patterns
  for (const pattern of SECRET_PATTERNS) {
    maskedText = maskedText.replace(pattern, '***');
  }

  return maskedText;
}

export { runCommands, collectCommands, executeCommand, maskSecrets };
