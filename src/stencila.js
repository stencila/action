// @ts-check

import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as exec from "@actions/exec";
import fs from "fs";
import path from "path";
import https from "https";
import crypto from "crypto";

/**
 * @typedef {import('./types.d.ts').Context} Context
 * @typedef {import('./types.d.ts').StencilaInfo} StencilaInfo
 */

/**
 * Fetch expected checksum for a release asset from GitHub API
 * @param {string} version - Version (e.g., "v2.0.0")
 * @param {string} platformString - Platform string (e.g., "x86_64-unknown-linux-gnu")
 * @param {string} extension - File extension ("tar.gz" or "zip")
 * @returns {Promise<string|null>} SHA256 checksum from GitHub API, or null if not available
 */
async function fetchChecksumFromGitHub(version, platformString, extension) {
  const filename = `cli-${version}-${platformString}.${extension}`;
  const apiUrl = `https://api.github.com/repos/stencila/stencila/releases/tags/${version}`;
  
  return new Promise((resolve) => {
    const req = https.get(
      apiUrl,
      {
        headers: {
          "User-Agent": "stencila-action",
          "Accept": "application/vnd.github.v3+json"
        }
      },
      (res) => {
        let data = "";
        
        res.on("data", (chunk) => {
          data += chunk;
        });
        
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) {
              core.warning(`⚠️ GitHub API returned ${res.statusCode} for ${version}`);
              resolve(null);
              return;
            }
            
            const release = JSON.parse(data);
            
            // Find the asset that matches our filename
            const asset = release.assets?.find(a => a.name === filename);
            
            if (asset && asset.sha256) {
              core.info(`📋 Found checksum for ${filename} from GitHub API`);
              resolve(asset.sha256);
            } else {
              core.warning(`⚠️ No checksum found for ${filename} in GitHub release ${version}`);
              resolve(null);
            }
          } catch (error) {
            core.warning(`⚠️ Failed to parse GitHub API response: ${error.message}`);
            resolve(null);
          }
        });
      }
    );
    
    req.on("error", (error) => {
      core.warning(`⚠️ Failed to fetch checksum from GitHub API: ${error.message}`);
      resolve(null);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      core.warning("⚠️ Timeout fetching checksum from GitHub API");
      resolve(null);
    });
  });
}

/**
 * Resolve the actual version from "latest" or validate specific version
 * @param {string} versionInput - User-specified version ("latest" or specific version)
 * @returns {Promise<string>} Resolved version (e.g., "v2.0.0")
 */
async function resolveVersion(versionInput) {
  if (versionInput === "latest") {
    core.info("Resolving latest version...");
    
    return new Promise((resolve, reject) => {
      const req = https.get(
        "https://github.com/stencila/stencila/releases/latest",
        {
          headers: {
            "User-Agent": "stencila-action"
          }
        },
        (res) => {
          if (res.statusCode === 302 && res.headers.location) {
            // Extract version from redirect URL like /stencila/stencila/releases/tag/v2.3.0
            const match = res.headers.location.match(/\/tag\/(v[\d.]+(?:-[\w.]+)?)$/);
            if (match) {
              const version = match[1];
              core.info(`Latest version resolved to: ${version}`);
              resolve(version);
            } else {
              reject(new Error(`Could not parse version from redirect URL: ${res.headers.location}`));
            }
          } else {
            reject(new Error(`Expected redirect from latest release URL, got ${res.statusCode}`));
          }
        }
      );
      
      req.on("error", (error) => {
        reject(new Error(`Failed to resolve latest version: ${error.message}`));
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Timeout resolving latest version"));
      });
    });
  } else {
    // Validate specific version format
    const versionPattern = /^v?\d+\.\d+\.\d+(-.*)?$/;
    if (!versionPattern.test(versionInput)) {
      throw new Error(`Invalid version format: ${versionInput}. Use 'latest' or a version like 'v2.0.0'`);
    }
    
    // Ensure version has 'v' prefix
    const normalizedVersion = versionInput.startsWith('v') ? versionInput : `v${versionInput}`;
    core.info(`Using specific version: ${normalizedVersion}`);
    return normalizedVersion;
  }
}

/**
 * Generate download URL for a specific version and platform
 * @param {string} version - Resolved version (e.g., "v2.0.0")
 * @param {string} platformString - Platform string (e.g., "x86_64-unknown-linux-gnu")
 * @param {string} extension - File extension ("tar.gz" or "zip")
 * @returns {string} Download URL
 */
function getDownloadUrl(version, platformString, extension) {
  return `https://github.com/stencila/stencila/releases/download/${version}/cli-${version}-${platformString}.${extension}`;
}

/**
 * Verify SHA256 checksum of downloaded file
 * @param {string} filePath - Path to downloaded file
 * @param {string} expectedChecksum - Expected SHA256 checksum (with or without "sha256:" prefix)
 * @returns {Promise<boolean>} True if checksum matches
 */
async function verifyChecksum(filePath, expectedChecksum) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actualChecksum = hash.digest('hex');
      const normalizedExpected = expectedChecksum.replace(/^sha256:/, '');
      
      if (actualChecksum === normalizedExpected) {
        core.info(`✅ Checksum verified: ${actualChecksum}`);
        resolve(true);
      } else {
        core.error(`❌ Checksum mismatch!`);
        core.error(`Expected: ${normalizedExpected}`);
        core.error(`Actual:   ${actualChecksum}`);
        resolve(false);
      }
    });
    
    stream.on('error', reject);
  });
}

/**
 * Download file with retry logic and exponential backoff
 * @param {string} url - Download URL
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<string>} Path to downloaded file
 */
async function downloadWithRetry(url, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        // Exponential backoff with jitter: base delay 1s, doubled each time, plus random jitter
        const baseDelay = 1000 * Math.pow(2, attempt - 2); // 1s, 2s, 4s...
        const jitter = Math.random() * 1000; // 0-1s random jitter
        const delay = baseDelay + jitter;
        
        core.info(`Retrying download in ${Math.round(delay / 1000)}s (attempt ${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      core.info(`Downloading from ${url} (attempt ${attempt}/${maxRetries})`);
      return await tc.downloadTool(url);
      
    } catch (error) {
      lastError = error;
      core.warning(`Download attempt ${attempt} failed: ${error.message}`);
      
      if (attempt === maxRetries) {
        throw new Error(`Download failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
      }
    }
  }
  
  throw lastError; // Should never reach here, but TypeScript requires it
}

/**
 * Find Stencila binary in extracted directory
 * @param {string} extractPath - Path to extracted directory
 * @param {string} platform - Platform name (linux, darwin, win32)
 * @returns {string} Path to Stencila binary
 */
function findStencilaBinary(extractPath, platform) {
  const binaryName = platform === "win32" ? "stencila.exe" : "stencila";
  
  // First check if binary is directly in extract path
  let candidatePath = path.join(extractPath, binaryName);
  if (fs.existsSync(candidatePath)) {
    return candidatePath;
  }
  
  // Look for binary in subdirectories
  const extractedItems = fs.readdirSync(extractPath);
  for (const item of extractedItems) {
    const itemPath = path.join(extractPath, item);
    if (fs.statSync(itemPath).isDirectory()) {
      candidatePath = path.join(itemPath, binaryName);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }
  
  throw new Error(`Could not find ${binaryName} in extracted archive at ${extractPath}`);
}

/**
 * Ensure Stencila CLI is available and ready to use
 * @param {Context} context - The context object to populate
 * @returns {Promise<Context>} The context with populated stencila info
 */
async function ensureStencila(context) {
  const startTime = Date.now();
  
  if (!context.inputs) {
    throw new Error("Context must have inputs populated before calling ensureStencila");
  }
  
  if (!context.env) {
    throw new Error("Context must have env populated before calling ensureStencila");
  }
  
  const { version: versionInput } = context.inputs;
  const { platform, platformString, extension } = context.env;
  
  try {
    // Step 1: Resolve version
    const resolvedVersion = await resolveVersion(versionInput);
    const downloadUrl = getDownloadUrl(resolvedVersion, platformString, extension);
    
    // Initialize stencila info
    /** @type {StencilaInfo} */
    const stencilaInfo = {
      version: versionInput,
      resolvedVersion,
      binaryPath: "",
      wasAlreadyInstalled: false,
      downloadUrl,
      checksumVerified: false,
      installDuration: 0
    };
    
    // Step 2: Check if already cached
    let cachedPath = tc.find("stencila", resolvedVersion);
    
    if (cachedPath) {
      core.info(`✅ Using cached Stencila CLI ${resolvedVersion} from ${cachedPath}`);
      stencilaInfo.wasAlreadyInstalled = true;
      
      // Construct path to binary
      const binaryName = platform === "win32" ? "stencila.exe" : "stencila";
      stencilaInfo.binaryPath = path.join(cachedPath, binaryName);
      
      if (!fs.existsSync(stencilaInfo.binaryPath)) {
        throw new Error(`Cached Stencila binary not found at ${stencilaInfo.binaryPath}`);
      }
    } else {
      // Step 3: Download and install
      core.info(`📦 Installing Stencila CLI ${resolvedVersion}...`);
      
      // Download with retry
      const downloadPath = await downloadWithRetry(downloadUrl, 3);
      
      // Step 4: Verify checksum if available from GitHub API
      core.info("🏅 Fetching checksum from GitHub API...");
      const expectedChecksum = await fetchChecksumFromGitHub(resolvedVersion, platformString, extension);
      if (expectedChecksum) {
        core.info("🔍 Verifying checksum...");
        const checksumValid = await verifyChecksum(downloadPath, expectedChecksum);
        if (!checksumValid) {
          throw new Error("Checksum verification failed. Download may be corrupted or tampered with.");
        }
        stencilaInfo.checksumVerified = true;
      } else {
        core.warning(`⚠️ No checksum available for ${resolvedVersion} on ${platformString} - skipping verification`);
        stencilaInfo.checksumVerified = false;
      }
      
      // Step 5: Extract archive
      core.info("📂 Extracting archive...");
      let extractPath;
      if (extension === "zip") {
        extractPath = await tc.extractZip(downloadPath);
      } else {
        extractPath = await tc.extractTar(downloadPath);
      }
      
      // Step 6: Find binary
      const binaryPath = findStencilaBinary(extractPath, platform);
      
      // Step 7: Make executable on Unix-like systems
      if (platform !== "win32") {
        await exec.exec("chmod", ["+x", binaryPath]);
      }
      
      // Step 8: Cache for future use
      const binaryDir = path.dirname(binaryPath);
      cachedPath = await tc.cacheDir(binaryDir, "stencila", resolvedVersion);
      core.info(`💾 Cached Stencila CLI to ${cachedPath}`);
      
      // Update binary path to cached location
      const binaryName = platform === "win32" ? "stencila.exe" : "stencila";
      stencilaInfo.binaryPath = path.join(cachedPath, binaryName);
    }
    
    // Step 9: Add to PATH
    core.addPath(path.dirname(stencilaInfo.binaryPath));
    
    // Step 10: Verify installation by checking version
    let installedVersionOutput = "";
    try {
      await exec.exec("stencila", ["--version"], {
        listeners: {
          stdout: (data) => {
            installedVersionOutput += data.toString();
          }
        }
      });
    } catch (error) {
      throw new Error(`Failed to verify Stencila installation: ${error.message}`);
    }
    
    const installedVersion = installedVersionOutput.trim();
    
    // Calculate installation duration
    stencilaInfo.installDuration = Date.now() - startTime;
    
    // Set outputs
    core.setOutput("version", installedVersion);
    core.setOutput("binary-path", stencilaInfo.binaryPath);
    
    // Log success
    if (stencilaInfo.wasAlreadyInstalled) {
      core.info(`✅ Stencila CLI ${installedVersion} was already installed (${stencilaInfo.installDuration}ms)`);
    } else {
      core.info(`✅ Stencila CLI ${installedVersion} installed successfully (${stencilaInfo.installDuration}ms)`);
    }
    
    // Add to context
    context.stencila = stencilaInfo;
    
    return context;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    core.error(`❌ Failed to install Stencila CLI after ${duration}ms: ${error.message}`);
    throw error;
  }
}

export { ensureStencila, resolveVersion, verifyChecksum, fetchChecksumFromGitHub };