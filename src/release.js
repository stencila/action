// @ts-check

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as glob from "@actions/glob";
import fs from "fs";
import path from "path";

/**
 * @typedef {import('./types.d.ts').Context} Context
 * @typedef {import('./types.d.ts').ReleaseInfo} ReleaseInfo
 */

/**
 * Maximum filename length for release assets
 */
const MAX_FILENAME_LENGTH = 100;

/**
 * Create GitHub release with assets
 * @param {Context} context - The context object to update
 * @returns {Promise<Context>} The context with populated release info
 */
async function createRelease(context) {
  if (!context.inputs) {
    throw new Error("Context must have inputs populated before creating release");
  }

  const { inputs } = context;
  const { releases: releasesInput, assets: assetsPath, releaseName, releaseNotes, releaseFilenames, workingDirectory, assumeAnswer } = inputs;

  // Check if releases are enabled and we're on a tag
  if (!releasesInput) {
    core.info("ℹ️ Release creation disabled");
    return context;
  }

  if (!process.env.GITHUB_REF || !process.env.GITHUB_REF.startsWith("refs/tags/")) {
    core.info("ℹ️ Release creation enabled but not on a tag. Skipping release.");
    return context;
  }

  const tagName = process.env.GITHUB_REF.replace("refs/tags/", "");
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is required for release creation. Please set "env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}" and add "permissions: contents: write" to your workflow job.'
    );
  }

  try {
    core.info(`🚀 Creating release for tag: ${tagName}`);

    const octokit = github.getOctokit(token);
    const githubContext = github.context;

    // Determine release assets path
    let releasesPath = "";
    if (releasesInput === true) {
      // Use assets pattern if release is true
      releasesPath = assetsPath || "";
    } else if (typeof releasesInput === "string") {
      // Use the provided pattern
      releasesPath = releasesInput;
    }

    // Auto-detect release files if not specified
    const detectedReleaseNotes = await autoDetectFile("release-notes", releaseNotes, workingDirectory);
    const detectedReleaseName = await autoDetectFile("release-name", releaseName, workingDirectory);
    const detectedReleaseFilenames = await autoDetectFile("release-filenames", releaseFilenames, workingDirectory);

    // Prepare template variables for Stencila
    const templateVars = await prepareTemplateVariables(tagName, githubContext);

    // Render release name and notes using Stencila
    const finalReleaseName = await renderTemplate(
      detectedReleaseName,
      tagName,
      templateVars,
      workingDirectory,
      assumeAnswer
    );
    
    const finalReleaseNotes = await renderTemplate(
      detectedReleaseNotes,
      "",
      templateVars,
      workingDirectory,
      assumeAnswer
    );

    // Detect if this is a prerelease
    const isPrerelease = detectPrerelease(tagName);

    // Create the release
    const releaseResponse = await octokit.rest.repos.createRelease({
      owner: githubContext.repo.owner,
      repo: githubContext.repo.repo,
      tag_name: tagName,
      name: finalReleaseName,
      body: finalReleaseNotes,
      draft: false,
      prerelease: isPrerelease
    });

    core.info(`✅ Created release: ${releaseResponse.data.html_url}`);

    const releaseInfo = {
      id: releaseResponse.data.id,
      tag: tagName,
      name: finalReleaseName,
      notes: finalReleaseNotes,
      prerelease: isPrerelease,
      assets: []
    };

    // Upload release assets if specified
    if (releasesPath) {
      releaseInfo.assets = await uploadReleaseAssets(
        octokit,
        githubContext,
        releaseResponse.data.id,
        releasesPath,
        detectedReleaseFilenames,
        templateVars,
        workingDirectory,
        assumeAnswer
      );
    }

    context.release = releaseInfo;
    return context;

  } catch (error) {
    throw new Error(`Failed to create release: ${error.message}`);
  }
}

/**
 * Auto-detect release configuration files
 * @param {string} baseName - Base name to search for
 * @param {string} userSpecified - User-specified file path
 * @param {string} workingDirectory - Working directory
 * @returns {Promise<string|null>} Detected file path or null
 */
async function autoDetectFile(baseName, userSpecified, workingDirectory) {
  if (userSpecified) return userSpecified;

  // Case insensitive patterns with - or _
  const patterns = [
    baseName.toLowerCase(),
    baseName.toUpperCase(),
    baseName.toLowerCase().replace("-", "_"),
    baseName.toUpperCase().replace("-", "_")
  ];

  try {
    const files = fs.readdirSync(workingDirectory);
    for (const file of files) {
      const fileStem = path.parse(file).name;
      if (patterns.includes(fileStem)) {
        return file;
      }
    }
  } catch {
    // Ignore errors reading directory
  }

  return null;
}

/**
 * Prepare template variables for Stencila rendering
 * @param {string} tagName - Git tag name
 * @param {object} githubContext - GitHub context
 * @returns {Promise<string[]>} Array of template variables
 */
async function prepareTemplateVariables(tagName, githubContext) {
  const now = new Date();
  return [
    `tag=${tagName}`,
    `datetime=${now
      .toISOString()
      .replace("T", "-")
      .replace(".", "-")
      .substring(0, 19)}`,
    `date=${now.toISOString().substring(0, 10)}`,
    `year=${now.getFullYear()}`,
    `month=${(now.getMonth() + 1).toString().padStart(2, "0")}`,
    `monthname=${now.toLocaleString("en-US", { month: "long" })}`,
    `day=${now.getDate().toString().padStart(2, "0")}`,
    `commit=${githubContext.sha.substring(0, 7)}`,
    `repo=${githubContext.repo.repo}`,
    `owner=${githubContext.repo.owner}`,
    `workflow=${githubContext.workflow}`,
    `build=${githubContext.runNumber}`
  ];
}

/**
 * Render template using Stencila
 * @param {string|null} template - Template content or file path
 * @param {string} defaultValue - Default value if template fails
 * @param {string[]} templateVars - Template variables
 * @param {string} workingDirectory - Working directory
 * @param {string} assumeAnswer - Assume answer for prompts
 * @returns {Promise<string>} Rendered content
 */
async function renderTemplate(template, defaultValue, templateVars, workingDirectory, assumeAnswer) {
  if (!template) return defaultValue;

  try {
    const isFile = fs.existsSync(path.resolve(workingDirectory, template));
    let result = "";

    if (isFile) {
      // Render file
      const exitCode = await exec.exec(
        "stencila",
        [
          "render",
          path.resolve(workingDirectory, template),
          "--to=md",
          `--${assumeAnswer}`,
          "--",
          ...templateVars
        ],
        {
          cwd: workingDirectory,
          listeners: {
            stdout: (data) => {
              result += data.toString();
            }
          },
          ignoreReturnCode: true
        }
      );

      if (exitCode !== 0) {
        core.warning(`⚠️ Failed to render template file: ${template}`);
        return defaultValue;
      }
    } else {
      // Render string via stdin
      const exitCode = await exec.exec(
        "stencila",
        [
          "render",
          "-",
          "--to=md",
          `--${assumeAnswer}`,
          "--",
          ...templateVars
        ],
        {
          cwd: workingDirectory,
          input: Buffer.from(template),
          listeners: {
            stdout: (data) => {
              result += data.toString();
            }
          },
          ignoreReturnCode: true
        }
      );

      if (exitCode !== 0) {
        core.warning(`⚠️ Failed to render template string: ${template}`);
        return defaultValue;
      }
    }

    return result.trim();
  } catch (error) {
    core.warning(`⚠️ Error rendering template: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Detect if tag represents a prerelease
 * @param {string} tagName - Git tag name
 * @returns {boolean} True if prerelease
 */
function detectPrerelease(tagName) {
  const prereleasePatterns = [
    /alpha/i,
    /beta/i,
    /rc/i,
    /pre/i,
    /dev/i,
    /-\d+$/,  // Trailing number (e.g., v1.0.0-1)
    /snapshot/i
  ];

  return prereleasePatterns.some(pattern => pattern.test(tagName));
}

/**
 * Sanitize filename for release assets
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  // Remove or replace problematic characters
  let sanitized = filename
    .replace(/[<>:"/\\|?*]/g, "_")  // Replace invalid characters
    .replace(/\s+/g, "_")          // Replace spaces with underscores
    .replace(/_{2,}/g, "_")        // Replace multiple underscores with single
    .replace(/^_+|_+$/g, "");      // Trim underscores from start/end

  // Ensure filename isn't too long
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const ext = path.extname(sanitized);
    const basename = path.basename(sanitized, ext);
    const maxBasename = MAX_FILENAME_LENGTH - ext.length;
    sanitized = basename.substring(0, maxBasename) + ext;
  }

  // Ensure we have a valid filename
  if (!sanitized || sanitized === ".") {
    sanitized = "asset";
  }

  return sanitized;
}

/**
 * Upload assets to GitHub release
 * @param {object} octokit - GitHub API client
 * @param {object} githubContext - GitHub context
 * @param {number} releaseId - Release ID
 * @param {string} releasesPath - Pattern for release assets
 * @param {string|null} releaseFilenames - Template for asset renaming
 * @param {string[]} templateVars - Template variables
 * @param {string} workingDirectory - Working directory
 * @param {string} assumeAnswer - Assume answer for prompts
 * @returns {Promise<string[]>} Array of uploaded asset names
 */
async function uploadReleaseAssets(octokit, githubContext, releaseId, releasesPath, releaseFilenames, templateVars, workingDirectory, assumeAnswer) {
  core.info(`🔍 Looking for release files matching: ${releasesPath}`);

  const globber = await glob.create(
    path.join(workingDirectory, releasesPath),
    {
      followSymbolicLinks: false,
      implicitDescendants: false,
      omitBrokenSymbolicLinks: true
    }
  );
  
  const files = await globber.glob();

  if (files.length === 0) {
    core.warning(`⚠️ No release files found matching pattern: ${releasesPath}`);
    return [];
  }

  core.info(`📁 Found ${files.length} file(s) to upload as release assets`);

  const uploadedAssets = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const originalFileName = path.basename(filePath);
    
    try {
      // Render filename using template if provided
      const finalFileName = await renderAssetFilename(
        filePath,
        releaseFilenames,
        templateVars,
        workingDirectory,
        assumeAnswer
      );
      
      const sanitizedFileName = sanitizeFilename(finalFileName);
      const fileContent = fs.readFileSync(filePath);

      await octokit.rest.repos.uploadReleaseAsset({
        owner: githubContext.repo.owner,
        repo: githubContext.repo.repo,
        release_id: releaseId,
        name: sanitizedFileName,
        data: fileContent
      });

      uploadedAssets.push(sanitizedFileName);

      if (sanitizedFileName !== originalFileName) {
        core.info(`✅ Uploaded release asset: ${originalFileName} → ${sanitizedFileName}`);
      } else {
        core.info(`✅ Uploaded release asset: ${sanitizedFileName}`);
      }
    } catch (uploadError) {
      core.warning(`⚠️ Failed to upload ${originalFileName}: ${uploadError.message}`);
    }
  }

  return uploadedAssets;
}

/**
 * Render filename using Stencila template
 * @param {string} filePath - Path to the file
 * @param {string|null} releaseFilenames - Filename template
 * @param {string[]} templateVars - Template variables
 * @param {string} workingDirectory - Working directory
 * @param {string} assumeAnswer - Assume answer for prompts
 * @returns {Promise<string>} Rendered filename
 */
async function renderAssetFilename(filePath, releaseFilenames, templateVars, workingDirectory, assumeAnswer) {
  if (!releaseFilenames) return path.basename(filePath);

  try {
    const parsedPath = path.parse(filePath);
    const fileVars = [
      `filepath=${filePath}`,
      `dirname=${parsedPath.dir}`,
      `filename=${parsedPath.base}`,
      `filestem=${parsedPath.name}`,
      `fileext=${parsedPath.ext}`
    ];

    const allVars = [...templateVars, ...fileVars];
    const newName = await renderTemplate(
      releaseFilenames,
      parsedPath.base,
      allVars,
      workingDirectory,
      assumeAnswer
    );
    
    return newName || parsedPath.base;
  } catch (error) {
    core.warning(`⚠️ Error rendering filename for ${filePath}: ${error.message}`);
    return path.basename(filePath);
  }
}

export { 
  createRelease, 
  autoDetectFile, 
  prepareTemplateVariables, 
  renderTemplate, 
  detectPrerelease, 
  sanitizeFilename,
  uploadReleaseAssets,
  renderAssetFilename
};