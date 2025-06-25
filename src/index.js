const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const path = require('path');
const os = require('os');

async function run() {
  try {
    // Get inputs
    const version = core.getInput('version') || 'latest';
    const command = core.getInput('command');
    const args = core.getInput('args');
    const workingDirectory = core.getInput('working-directory') || '.';

    // Determine platform
    const platform = os.platform();
    const arch = os.arch();
    
    let platformSuffix;
    let archSuffix;
    
    switch (platform) {
      case 'linux':
        platformSuffix = 'linux';
        break;
      case 'darwin':
        platformSuffix = 'macos';
        break;
      case 'win32':
        platformSuffix = 'windows';
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    switch (arch) {
      case 'x64':
        archSuffix = 'x86_64';
        break;
      case 'arm64':
        archSuffix = 'aarch64';
        break;
      default:
        throw new Error(`Unsupported architecture: ${arch}`);
    }

    // Construct download URL
    let downloadUrl;
    if (version === 'latest') {
      downloadUrl = `https://github.com/stencila/stencila/releases/latest/download/stencila-${platformSuffix}-${archSuffix}.tar.gz`;
    } else {
      downloadUrl = `https://github.com/stencila/stencila/releases/download/v${version}/stencila-${platformSuffix}-${archSuffix}.tar.gz`;
    }

    core.info(`Downloading Stencila CLI from ${downloadUrl}`);

    // Download and extract
    const downloadPath = await tc.downloadTool(downloadUrl);
    const extractPath = await tc.extractTar(downloadPath);
    
    // Find the stencila binary
    const stencilaPath = path.join(extractPath, 'stencila');
    
    // Make it executable on Unix-like systems
    if (platform !== 'win32') {
      await exec.exec('chmod', ['+x', stencilaPath]);
    }

    // Add to PATH
    core.addPath(path.dirname(stencilaPath));

    // Get installed version
    let installedVersion = '';
    await exec.exec('stencila', ['--version'], {
      listeners: {
        stdout: (data) => {
          installedVersion += data.toString();
        }
      }
    });

    core.setOutput('version', installedVersion.trim());
    core.info(`Stencila CLI ${installedVersion.trim()} installed successfully`);

    // Run command if provided
    if (command) {
      core.info(`Running: stencila ${command} ${args || ''}`);
      
      const exitCode = await exec.exec('stencila', [command, ...(args ? args.split(' ') : [])], {
        cwd: workingDirectory,
        ignoreReturnCode: true
      });

      core.setOutput('exit-code', exitCode.toString());
      
      if (exitCode !== 0) {
        core.setFailed(`Stencila command failed with exit code ${exitCode}`);
      }
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();