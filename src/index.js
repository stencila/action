const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

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
    
    let platformString;
    let extension = 'tar.gz';
    
    switch (platform) {
      case 'linux':
        if (arch === 'x64') {
          platformString = 'x86_64-unknown-linux-gnu';
        } else {
          throw new Error(`Unsupported Linux architecture: ${arch}`);
        }
        break;
      case 'darwin':
        if (arch === 'x64') {
          platformString = 'x86_64-apple-darwin';
        } else if (arch === 'arm64') {
          platformString = 'aarch64-apple-darwin';
        } else {
          throw new Error(`Unsupported macOS architecture: ${arch}`);
        }
        break;
      case 'win32':
        if (arch === 'x64') {
          platformString = 'x86_64-pc-windows-msvc';
          extension = 'zip';
        } else {
          throw new Error(`Unsupported Windows architecture: ${arch}`);
        }
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    // Construct download URL
    let downloadUrl;
    if (version === 'latest') {
      // For latest, follow the redirect to get the actual version
      const latestVersion = await new Promise((resolve, reject) => {
        https.get('https://github.com/stencila/stencila/releases/latest', (res) => {
          if (res.statusCode === 302 && res.headers.location) {
            // Extract version from redirect URL like /stencila/stencila/releases/tag/v2.3.0
            const match = res.headers.location.match(/\/tag\/(v[\d.]+)$/);
            if (match) {
              resolve(match[1]);
            } else {
              reject(new Error('Could not parse version from redirect'));
            }
          } else {
            reject(new Error('Expected redirect from latest release URL'));
          }
        }).on('error', reject);
      });
      
      downloadUrl = `https://github.com/stencila/stencila/releases/download/${latestVersion}/cli-${latestVersion}-${platformString}.${extension}`;
    } else {
      downloadUrl = `https://github.com/stencila/stencila/releases/download/v${version}/cli-v${version}-${platformString}.${extension}`;
    }

    core.info(`Downloading Stencila CLI from ${downloadUrl}`);

    // Download and extract
    const downloadPath = await tc.downloadTool(downloadUrl);
    let extractPath;
    if (extension === 'zip') {
      extractPath = await tc.extractZip(downloadPath);
    } else {
      extractPath = await tc.extractTar(downloadPath);
    }
    
    // Find the stencila binary - it's nested in a folder
    // First, find the extracted folder (it should be named like cli-v2.3.0-x86_64-unknown-linux-gnu)
    const extractedItems = fs.readdirSync(extractPath);
    let stencilaPath;
    
    // Look for the stencila binary in the extracted folder
    for (const item of extractedItems) {
      const itemPath = path.join(extractPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        // Check if stencila binary exists in this directory
        const binaryPath = path.join(itemPath, platform === 'win32' ? 'stencila.exe' : 'stencila');
        if (fs.existsSync(binaryPath)) {
          stencilaPath = binaryPath;
          break;
        }
      }
    }
    
    if (!stencilaPath) {
      // If not found in subdirectory, check root
      stencilaPath = path.join(extractPath, platform === 'win32' ? 'stencila.exe' : 'stencila');
      if (!fs.existsSync(stencilaPath)) {
        throw new Error('Could not find stencila binary in extracted archive');
      }
    }
    
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