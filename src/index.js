const { DefaultArtifactClient } = require('@actions/artifact');
const cache = require('@actions/cache');
const core = require('@actions/core');
const exec = require('@actions/exec');
const glob = require('@actions/glob');
const tc = require('@actions/tool-cache');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

async function run() {
  try {
    // Get inputs
    const version = core.getInput('version') || 'latest';
    let command = core.getInput('command');
    let args = core.getInput('args');
    const workingDirectory = core.getInput('working-directory') || '.';
    const useCache = core.getBooleanInput('cache');
    const outputsPath = core.getInput('outputs');
    const outputsName = core.getInput('outputs-name') || 'outputs';
    
    // Check for simplified command syntax
    const commands = ['convert', 'lint', 'execute', 'render'];
    for (const cmd of commands) {
      const cmdArgs = core.getInput(cmd);
      if (cmdArgs) {
        if (command) {
          throw new Error(`Cannot specify both 'command' and '${cmd}' inputs`);
        }
        command = cmd;
        args = cmdArgs;
      }
    }

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

    // Resolve actual version for caching
    let actualVersion = version;
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
      
      actualVersion = latestVersion;
      downloadUrl = `https://github.com/stencila/stencila/releases/download/${latestVersion}/cli-${latestVersion}-${platformString}.${extension}`;
    } else {
      downloadUrl = `https://github.com/stencila/stencila/releases/download/v${version}/cli-v${version}-${platformString}.${extension}`;
    }

    // Check if Stencila is already cached/installed using actual version
    let cachedPath = tc.find('stencila', actualVersion);
    let stencilaPath;

    if (cachedPath) {
      // Use cached version
      core.info(`Using cached Stencila CLI from ${cachedPath}`);
      stencilaPath = path.join(cachedPath, platform === 'win32' ? 'stencila.exe' : 'stencila');
    } else {
      // Download and install
      core.info(`Downloading Stencila CLI from ${downloadUrl}`);

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

      // Cache the extracted binary directory for future use
      const binaryDir = path.dirname(stencilaPath);
      cachedPath = await tc.cacheDir(binaryDir, 'stencila', actualVersion);
      core.info(`Cached Stencila CLI to ${cachedPath}`);
      
      // Update path to cached location
      stencilaPath = path.join(cachedPath, platform === 'win32' ? 'stencila.exe' : 'stencila');
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

    // Cache restoration logic
    let cacheRestored = false;
    const stencilaCachePath = path.join(workingDirectory, '.stencila');
    let cacheKey = '';
    
    if (useCache && command) {
      // Generate cache key based on OS, Stencila version, and workflow file hash
      cacheKey = `stencila-cache-${platform}-${arch}-${actualVersion}-${process.env.GITHUB_SHA || 'default'}`;
      const restoreKeys = [
        `stencila-cache-${platform}-${arch}-${actualVersion}-`,
        `stencila-cache-${platform}-${arch}-`
      ];
      
      try {
        core.info(`Restoring .stencila cache with key: ${cacheKey}`);
        const cacheHit = await cache.restoreCache([stencilaCachePath], cacheKey, restoreKeys);
        
        if (cacheHit) {
          core.info(`Cache restored from key: ${cacheHit}`);
          cacheRestored = true;
        } else {
          core.info('No cache found, starting fresh');
        }
      } catch (error) {
        core.warning(`Failed to restore cache: ${error.message}`);
      }
    }

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
      
      // Save cache after command execution
      if (useCache && fs.existsSync(stencilaCachePath)) {
        try {
          core.info(`Saving .stencila cache with key: ${cacheKey}`);
          await cache.saveCache([stencilaCachePath], cacheKey);
          core.info('Cache saved successfully');
        } catch (error) {
          if (error.name === 'ValidationError' && error.message.includes('already exists')) {
            core.info('Cache already exists, skipping save');
          } else {
            core.warning(`Failed to save cache: ${error.message}`);
          }
        }
      }
      
      // Upload artifacts if specified
      if (outputsPath && exitCode === 0) {
        try {
          core.info(`Looking for files matching: ${outputsPath}`);
          
          // Create globber with the artifact path pattern
          const globber = await glob.create(path.join(workingDirectory, outputsPath));
          const files = await globber.glob();
          
          if (files.length === 0) {
            core.warning(`No files found matching pattern: ${outputsPath}`);
          } else {
            core.info(`Found ${files.length} file(s) to upload`);
            
            // Create artifact client
            const artifactClient = new DefaultArtifactClient();
            
            // Upload the artifact with proper root directory
            const {id, size} = await artifactClient.uploadArtifact(
              outputsName,
              files,
              path.resolve(workingDirectory),
              {
                retentionDays: 90
              }
            );
            
            core.info(`Successfully uploaded artifact '${outputsName}' (ID: ${id}, Size: ${size} bytes) with ${files.length} file(s)`);
          }
        } catch (error) {
          core.warning(`Failed to upload artifacts: ${error.message}`);
        }
      }
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();