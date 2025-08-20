import { DefaultArtifactClient } from "@actions/artifact";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as glob from "@actions/glob";
import fs from "fs";
import path from "path";

// Import new modules (strangler pattern - gradual migration)
import { parseInputs } from "./inputs.js";
import { resolveEnvironment } from "./environment.js";
import { ensureStencila } from "./stencila.js";
import { runCommands } from "./runner.js";

async function run() {
  try {
    // Initialize context object
    const context = {};
    
    // Phase 1: Use new modules for input parsing and environment resolution
    await core.group("Parse inputs", () => parseInputs(context));
    await core.group("Setup environment", () => resolveEnvironment(context));
    
    // Phase 2: Use new stencila module for installation
    await core.group("Install Stencila", () => ensureStencila(context));
    
    // Extract values from context for backward compatibility with existing code
    const { inputs, env } = context;
    const { workingDirectory, useCache, installTools, assumeAnswer } = inputs;
    const { assetsPath, artifactName, releasesInput, releaseName, releaseNotes, releaseFilenames } = inputs;

    // Parse release input - already handled in inputs module
    let enableReleases = false;
    let releasesPath = "";
    if (releasesInput && releasesInput !== false && assetsPath) {
      enableReleases = true;
      if (releasesInput === true) {
        // Use assets pattern if release is true
        releasesPath = assetsPath;
      } else {
        // Use the provided pattern (it's a string)
        releasesPath = releasesInput;
      }
    }

    // Cache restoration logic
    const stencilaCachePath = path.join(workingDirectory, ".stencila");
    let cacheKey = "";

    if (useCache) {
      // Generate cache key based on OS, Stencila version, and workflow file hash
      const { platform, arch } = env;
      const { resolvedVersion } = context.stencila;
      cacheKey = `stencila-cache-${platform}-${arch}-${resolvedVersion}-${
        process.env.GITHUB_SHA || "default"
      }`;
      const restoreKeys = [
        `stencila-cache-${platform}-${arch}-${resolvedVersion}-`,
        `stencila-cache-${platform}-${arch}-`,
      ];

      try {
        core.info(`🔄 Restoring .stencila cache with key: ${cacheKey}`);
        const cacheHit = await cache.restoreCache(
          [stencilaCachePath],
          cacheKey,
          restoreKeys
        );

        if (cacheHit) {
          core.info(`✅ Cache restored from key: ${cacheHit}`);
        } else {
          core.info("ℹ️ No cache found, starting fresh");
        }
      } catch (error) {
        core.warning(`⚠️ Failed to restore cache: ${error.message}`);
      }
    }

    // Install tools if requested
    if (installTools) {
      core.info("🔧 Installing Stencila tools...");
      const installExitCode = await exec.exec(
        "stencila",
        ["tools", "install", `--${assumeAnswer}`],
        {
          cwd: workingDirectory,
          ignoreReturnCode: true,
        }
      );

      if (installExitCode !== 0) {
        core.warning(
          `⚠️ Failed to install tools with exit code ${installExitCode}`
        );
      } else {
        core.info("✅ Tools installed successfully");
      }
    }

    // Phase 3: Use new runner module for command execution
    await core.group("Run commands", () => runCommands(context));

    // Extract results for backward compatibility
    const overallSuccess = context.results ? context.results.every(r => r.exitCode === 0) : true;

    // Save cache after command execution
    if (useCache && context.results && context.results.length > 0 && fs.existsSync(stencilaCachePath)) {
      try {
        core.info(`💾 Saving .stencila cache with key: ${cacheKey}`);
        await cache.saveCache([stencilaCachePath], cacheKey);
      } catch (error) {
        if (
          error.name === "ValidationError" &&
          error.message.includes("already exists")
        ) {
          core.info("ℹ️ Cache already exists, skipping save");
        } else {
          core.warning(`⚠️ Failed to save cache: ${error.message}`);
        }
      }
    }

    // Upload assets artifact if specified and all commands succeeded
    if (assetsPath && overallSuccess) {
      try {
        core.info(`🔍 Looking for files matching: ${assetsPath}`);

        // Create globber with the artifact path pattern
        const globber = await glob.create(
          path.join(workingDirectory, assetsPath)
        );
        const files = await globber.glob();

        if (files.length === 0) {
          core.warning(`⚠️ No files found matching pattern: ${assetsPath}`);
        } else {
          core.info(`📁 Found ${files.length} file(s) to upload`);

          // Create artifact client
          const artifactClient = new DefaultArtifactClient();

          // Upload the artifact with proper root directory
          const { id, size } = await artifactClient.uploadArtifact(
            artifactName,
            files,
            path.resolve(workingDirectory),
            {
              retentionDays: 90,
            }
          );

          core.info(
            `✅ Successfully uploaded artifact '${artifactName}' (ID: ${id}, Size: ${size} bytes) with ${files.length} file(s)`
          );
        }
      } catch (error) {
        core.warning(`⚠️ Failed to upload artifacts: ${error.message}`);
      }
    }

    // Handle GitHub releases if enabled
    if (
      enableReleases &&
      process.env.GITHUB_REF &&
      process.env.GITHUB_REF.startsWith("refs/tags/")
    ) {
      try {
        const tagName = process.env.GITHUB_REF.replace("refs/tags/", "");
        const token = process.env.GITHUB_TOKEN;

        if (!token) {
          throw new Error(
            'GITHUB_TOKEN is required for release creation. Please set "env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}" and add "permissions: contents: write" to your workflow job.'
          );
        }

        core.info(`🚀 Creating release for tag: ${tagName}`);

        const octokit = github.getOctokit(token);
        const context = github.context;

        // Auto-detect release files if not specified
        const autoDetectFile = (baseName, userSpecified) => {
          if (userSpecified) return userSpecified;

          // Case insensitive patterns with - or _
          const patterns = [
            baseName.toLowerCase(),
            baseName.toUpperCase(),
            baseName.toLowerCase().replace("-", "_"),
            baseName.toUpperCase().replace("-", "_"),
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
        };

        // Auto-detect release-notes, release-name, and release-filenames files
        const detectedReleaseNotes = autoDetectFile(
          "release-notes",
          releaseNotes
        );
        const detectedReleaseName = autoDetectFile("release-name", releaseName);
        const detectedReleaseFilenames = autoDetectFile(
          "release-filenames",
          releaseFilenames
        );

        // Prepare template variables for Stencila
        const now = new Date();
        const templateVars = [
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
          `commit=${context.sha.substring(0, 7)}`,
          `repo=${context.repo.repo}`,
          `owner=${context.repo.owner}`,
          `workflow=${context.workflow}`,
          `build=${context.runNumber}`,
        ];

        // Helper function to render template using Stencila
        const renderTemplate = async (
          template,
          defaultValue,
          extraVars = []
        ) => {
          if (!template) return defaultValue;

          try {
            const isFile = fs.existsSync(
              path.resolve(workingDirectory, template)
            );
            let result = "";
            const allVars = [...templateVars, ...extraVars];

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
                  ...allVars,
                ],
                {
                  cwd: workingDirectory,
                  listeners: {
                    stdout: (data) => {
                      result += data.toString();
                    },
                  },
                  ignoreReturnCode: true,
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
                  ...allVars,
                ],
                {
                  cwd: workingDirectory,
                  input: Buffer.from(template),
                  listeners: {
                    stdout: (data) => {
                      result += data.toString();
                    },
                  },
                  ignoreReturnCode: true,
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
        };

        // Helper function to render filename using Stencila with file-specific variables
        const renderFilename = async (filePath) => {
          if (!detectedReleaseFilenames) return path.basename(filePath);

          try {
            const parsedPath = path.parse(filePath);

            const fileVars = [
              `filepath=${filePath}`,
              `dirname=${parsedPath.dir}`,
              `filename=${parsedPath.base}`,
              `filestem=${parsedPath.name}`,
              `fileext=${parsedPath.ext}`,
            ];

            const newName = await renderTemplate(
              detectedReleaseFilenames,
              parsedPath.base,
              fileVars
            );
            return newName || parsedPath.base;
          } catch (error) {
            core.warning(
              `⚠️ Error rendering filename for ${filePath}: ${error.message}`
            );
            return path.basename(filePath);
          }
        };

        // Render release name and notes
        const finalReleaseName = await renderTemplate(
          detectedReleaseName,
          tagName
        );
        const finalReleaseNotes = await renderTemplate(
          detectedReleaseNotes,
          ""
        );

        // Create the release
        const releaseResponse = await octokit.rest.repos.createRelease({
          owner: context.repo.owner,
          repo: context.repo.repo,
          tag_name: tagName,
          name: finalReleaseName,
          body: finalReleaseNotes,
          draft: false,
          prerelease:
            tagName.includes("alpha") ||
            tagName.includes("beta") ||
            tagName.includes("rc"),
        });

        core.info(`✅ Created release: ${releaseResponse.data.html_url}`);

        // Upload release assets if specified
        if (releasesPath) {
          core.info(`🔍 Looking for release files matching: ${releasesPath}`);

          const globber = await glob.create(
            path.join(workingDirectory, releasesPath)
          );
          const files = await globber.glob();

          if (files.length === 0) {
            core.warning(
              `⚠️ No release files found matching pattern: ${releasesPath}`
            );
          } else {
            core.info(
              `📁 Found ${files.length} file(s) to upload as release assets`
            );

            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const originalFileName = path.basename(file);
              const finalFileName = await renderFilename(file);
              const fileContent = fs.readFileSync(file);

              try {
                await octokit.rest.repos.uploadReleaseAsset({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  release_id: releaseResponse.data.id,
                  name: finalFileName,
                  data: fileContent,
                });

                if (finalFileName !== originalFileName) {
                  core.info(
                    `✅ Uploaded release asset: ${originalFileName} → ${finalFileName}`
                  );
                } else {
                  core.info(`✅ Uploaded release asset: ${finalFileName}`);
                }
              } catch (uploadError) {
                core.warning(
                  `⚠️ Failed to upload ${originalFileName}: ${uploadError.message}`
                );
              }
            }
          }
        }
      } catch (error) {
        core.setFailed(`Failed to create release: ${error.message}`);
      }
    } else if (enableReleases) {
      core.info("ℹ️ Release creation enabled but not on a tag. Skipping release.");
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
