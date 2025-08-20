// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { createCoreMock } from "./helpers/mock-actions.js";

// Create the mocks at the top level
const coreMock = createCoreMock();

// Mock dependencies
vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/exec", () => ({
  exec: vi.fn()
}));
vi.mock("@actions/github", () => ({
  getOctokit: vi.fn(),
  context: {
    repo: { owner: "test-owner", repo: "test-repo" },
    sha: "abcdef1234567890",
    workflow: "test-workflow",
    runNumber: 42
  }
}));
vi.mock("@actions/glob", () => ({
  create: vi.fn()
}));
vi.mock("fs");

// Import the module after mocking
const {
  createRelease,
  autoDetectFile,
  prepareTemplateVariables,
  renderTemplate,
  detectPrerelease,
  sanitizeFilename,
  uploadReleaseAssets,
  renderAssetFilename
} = await import("../src/release.js");

describe("release.js", () => {
  let mockOctokit;
  let mockGlobber;
  const originalEnv = process.env;

  beforeEach(async () => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();

    // Reset environment
    process.env = { ...originalEnv };

    // Create mock octokit
    mockOctokit = {
      rest: {
        repos: {
          createRelease: vi.fn(),
          uploadReleaseAsset: vi.fn()
        }
      }
    };

    // Create mock globber
    mockGlobber = {
      glob: vi.fn()
    };

    // Set up GitHub mock
    const github = await import("@actions/github");
    vi.mocked(github.getOctokit).mockReturnValue(mockOctokit);

    // Set up glob mock
    const glob = await import("@actions/glob");
    vi.mocked(glob.create).mockResolvedValue(mockGlobber);

    // Set up default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("test content"));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("detectPrerelease", () => {
    it("should detect prerelease tags", () => {
      expect(detectPrerelease("v1.0.0-alpha")).toBe(true);
      expect(detectPrerelease("v1.0.0-beta.1")).toBe(true);
      expect(detectPrerelease("v1.0.0-rc.1")).toBe(true);
      expect(detectPrerelease("v1.0.0-pre")).toBe(true);
      expect(detectPrerelease("v1.0.0-dev")).toBe(true);
      expect(detectPrerelease("v1.0.0-1")).toBe(true);
      expect(detectPrerelease("v1.0.0-snapshot")).toBe(true);
    });

    it("should not detect stable releases as prerelease", () => {
      expect(detectPrerelease("v1.0.0")).toBe(false);
      expect(detectPrerelease("v2.1.3")).toBe(false);
      expect(detectPrerelease("1.0.0")).toBe(false);
    });
  });

  describe("sanitizeFilename", () => {
    it("should sanitize problematic characters", () => {
      expect(sanitizeFilename("file<name>")).toBe("file_name");
      expect(sanitizeFilename("file:name")).toBe("file_name");
      expect(sanitizeFilename("file name")).toBe("file_name");
      expect(sanitizeFilename("file___name")).toBe("file_name");
      expect(sanitizeFilename("___file___")).toBe("file");
    });

    it("should handle long filenames", () => {
      const longName = "a".repeat(150) + ".txt";
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result.endsWith(".txt")).toBe(true);
    });

    it("should handle edge cases", () => {
      expect(sanitizeFilename("")).toBe("asset");
      expect(sanitizeFilename(".")).toBe("asset");
      expect(sanitizeFilename("___")).toBe("asset");
    });
  });

  describe("autoDetectFile", () => {
    it("should return user-specified file if provided", async () => {
      const result = await autoDetectFile("release-notes", "custom.md", "/tmp");
      expect(result).toBe("custom.md");
    });

    it("should auto-detect files in directory", async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        "release-notes.md",
        "other.txt",
        "RELEASE_NOTES.txt"
      ]);

      const result = await autoDetectFile("release-notes", "", "/tmp");
      expect(result).toBe("release-notes.md");
    });

    it("should handle case variations", async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        "RELEASE_NOTES.md",
        "other.txt"
      ]);

      const result = await autoDetectFile("release-notes", "", "/tmp");
      expect(result).toBe("RELEASE_NOTES.md");
    });

    it("should return null if no files found", async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(["other.txt"]);

      const result = await autoDetectFile("release-notes", "", "/tmp");
      expect(result).toBe(null);
    });

    it("should handle directory read errors", async () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = await autoDetectFile("release-notes", "", "/tmp");
      expect(result).toBe(null);
    });
  });

  describe("prepareTemplateVariables", () => {
    it("should create template variables from context", async () => {
      const tagName = "v1.0.0";
      const githubContext = {
        sha: "abcdef1234567890",
        repo: { owner: "test-owner", repo: "test-repo" },
        workflow: "test-workflow",
        runNumber: 42
      };

      const vars = await prepareTemplateVariables(tagName, githubContext);

      expect(vars).toContain("tag=v1.0.0");
      expect(vars).toContain("commit=abcdef1");
      expect(vars).toContain("repo=test-repo");
      expect(vars).toContain("owner=test-owner");
      expect(vars).toContain("workflow=test-workflow");
      expect(vars).toContain("build=42");
      expect(vars.some(v => v.startsWith("date="))).toBe(true);
      expect(vars.some(v => v.startsWith("year="))).toBe(true);
    });
  });

  describe("renderTemplate", () => {
    let mockExec;

    beforeEach(async () => {
      const exec = await import("@actions/exec");
      mockExec = vi.mocked(exec.exec);
    });

    it("should return default value for empty template", async () => {
      const result = await renderTemplate(null, "default", [], "/tmp", "yes");
      expect(result).toBe("default");
    });

    it("should render file template successfully", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockExec.mockImplementation(async (command, args, options) => {
        if (options.listeners && options.listeners.stdout) {
          options.listeners.stdout(Buffer.from("rendered content"));
        }
        return 0;
      });

      const result = await renderTemplate(
        "template.md",
        "default",
        ["tag=v1.0.0"],
        "/tmp",
        "yes"
      );

      expect(result).toBe("rendered content");
      expect(mockExec).toHaveBeenCalledWith(
        "stencila",
        ["render", "/tmp/template.md", "--to=md", "--yes", "--", "tag=v1.0.0"],
        expect.objectContaining({
          cwd: "/tmp",
          ignoreReturnCode: true
        })
      );
    });

    it("should render string template successfully", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockExec.mockImplementation(async (command, args, options) => {
        if (options.listeners && options.listeners.stdout) {
          options.listeners.stdout(Buffer.from("rendered string"));
        }
        return 0;
      });

      const result = await renderTemplate(
        "Hello {{tag}}",
        "default",
        ["tag=v1.0.0"],
        "/tmp",
        "yes"
      );

      expect(result).toBe("rendered string");
      expect(mockExec).toHaveBeenCalledWith(
        "stencila",
        ["render", "-", "--to=md", "--yes", "--", "tag=v1.0.0"],
        expect.objectContaining({
          cwd: "/tmp",
          input: Buffer.from("Hello {{tag}}"),
          ignoreReturnCode: true
        })
      );
    });

    it("should return default value on render failure", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockExec.mockResolvedValue(1); // Non-zero exit code

      const result = await renderTemplate(
        "Hello {{tag}}",
        "default",
        ["tag=v1.0.0"],
        "/tmp",
        "yes"
      );

      expect(result).toBe("default");
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Failed to render template string")
      );
    });

    it("should handle exec errors gracefully", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockExec.mockRejectedValue(new Error("Command failed"));

      const result = await renderTemplate(
        "Hello {{tag}}",
        "default",
        ["tag=v1.0.0"],
        "/tmp",
        "yes"
      );

      expect(result).toBe("default");
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Error rendering template")
      );
    });
  });

  describe("renderAssetFilename", () => {
    let mockExec;

    beforeEach(async () => {
      const exec = await import("@actions/exec");
      mockExec = vi.mocked(exec.exec);
    });

    it("should return original filename when no template", async () => {
      const result = await renderAssetFilename(
        "/tmp/test.txt",
        null,
        [],
        "/tmp",
        "yes"
      );

      expect(result).toBe("test.txt");
    });

    it("should render filename with file variables", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockExec.mockImplementation(async (command, args, options) => {
        if (options.listeners && options.listeners.stdout) {
          options.listeners.stdout(Buffer.from("new-name.txt"));
        }
        return 0;
      });

      const result = await renderAssetFilename(
        "/tmp/dir/test.txt",
        "{{filestem}}-new{{fileext}}",
        ["tag=v1.0.0"],
        "/tmp",
        "yes"
      );

      expect(result).toBe("new-name.txt");
      expect(mockExec).toHaveBeenCalledWith(
        "stencila",
        expect.arrayContaining([
          "render",
          "-",
          "--to=md",
          "--yes",
          "--",
          "tag=v1.0.0",
          "filepath=/tmp/dir/test.txt",
          "dirname=/tmp/dir",
          "filename=test.txt",
          "filestem=test",
          "fileext=.txt"
        ]),
        expect.any(Object)
      );
    });

    it("should handle render errors gracefully", async () => {
      mockExec.mockRejectedValue(new Error("Render failed"));

      const result = await renderAssetFilename(
        "/tmp/test.txt",
        "{{filestem}}-new{{fileext}}",
        [],
        "/tmp",
        "yes"
      );

      expect(result).toBe("test.txt");
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Error rendering template")
      );
    });
  });

  describe("uploadReleaseAssets", () => {
    const githubContext = {
      repo: { owner: "test-owner", repo: "test-repo" }
    };

    it("should upload release assets successfully", async () => {
      const files = ["/tmp/asset1.txt", "/tmp/asset2.txt"];
      mockGlobber.glob.mockResolvedValue(files);
      mockOctokit.rest.repos.uploadReleaseAsset.mockResolvedValue({});

      const result = await uploadReleaseAssets(
        mockOctokit,
        githubContext,
        123,
        "*.txt",
        null,
        ["tag=v1.0.0"],
        "/tmp",
        "yes"
      );

      expect(result).toEqual(["asset1.txt", "asset2.txt"]);
      expect(mockOctokit.rest.repos.uploadReleaseAsset).toHaveBeenCalledTimes(2);
    });

    it("should handle no files found", async () => {
      mockGlobber.glob.mockResolvedValue([]);

      const result = await uploadReleaseAssets(
        mockOctokit,
        githubContext,
        123,
        "*.txt",
        null,
        [],
        "/tmp",
        "yes"
      );

      expect(result).toEqual([]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("No release files found")
      );
    });

    it("should handle upload errors gracefully", async () => {
      const files = ["/tmp/asset1.txt"];
      mockGlobber.glob.mockResolvedValue(files);
      mockOctokit.rest.repos.uploadReleaseAsset.mockRejectedValue(
        new Error("Upload failed")
      );

      const result = await uploadReleaseAssets(
        mockOctokit,
        githubContext,
        123,
        "*.txt",
        null,
        [],
        "/tmp",
        "yes"
      );

      expect(result).toEqual([]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Failed to upload asset1.txt")
      );
    });

    it("should sanitize filenames", async () => {
      const files = ["/tmp/bad<name>.txt"];
      mockGlobber.glob.mockResolvedValue(files);
      mockOctokit.rest.repos.uploadReleaseAsset.mockResolvedValue({});

      const result = await uploadReleaseAssets(
        mockOctokit,
        githubContext,
        123,
        "*.txt",
        null,
        [],
        "/tmp",
        "yes"
      );

      expect(result).toEqual(["bad_name_.txt"]);
      expect(mockOctokit.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "bad_name_.txt"
        })
      );
    });
  });

  describe("createRelease", () => {
    beforeEach(() => {
      process.env.GITHUB_REF = "refs/tags/v1.0.0";
      process.env.GITHUB_TOKEN = "fake-token";
    });

    it("should skip release creation when disabled", async () => {
      const context = {
        inputs: { releases: false }
      };

      const result = await createRelease(context);

      expect(result).toBe(context);
      expect(coreMock.info).toHaveBeenCalledWith("ℹ️ Release creation disabled");
    });

    it("should skip release creation when not on tag", async () => {
      process.env.GITHUB_REF = "refs/heads/main";
      const context = {
        inputs: { releases: true }
      };

      const result = await createRelease(context);

      expect(result).toBe(context);
      expect(coreMock.info).toHaveBeenCalledWith(
        expect.stringContaining("not on a tag")
      );
    });

    it("should throw error when GITHUB_TOKEN missing", async () => {
      delete process.env.GITHUB_TOKEN;
      const context = {
        inputs: { releases: true }
      };

      await expect(createRelease(context)).rejects.toThrow(
        "GITHUB_TOKEN is required"
      );
    });

    it("should create release successfully", async () => {
      const context = {
        inputs: {
          releases: true,
          assets: "",
          releaseName: "",
          releaseNotes: "",
          releaseFilenames: "",
          workingDirectory: "/tmp",
          assumeAnswer: "yes"
        }
      };

      mockOctokit.rest.repos.createRelease.mockResolvedValue({
        data: {
          id: 123,
          html_url: "https://github.com/test/repo/releases/tag/v1.0.0"
        }
      });

      const result = await createRelease(context);

      expect(result.release).toMatchObject({
        id: 123,
        tag: "v1.0.0",
        name: "v1.0.0",
        notes: "",
        prerelease: false,
        assets: []
      });

      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "",
        draft: false,
        prerelease: false
      });
    });

    it("should detect prerelease tags", async () => {
      process.env.GITHUB_REF = "refs/tags/v1.0.0-beta";
      const context = {
        inputs: {
          releases: true,
          assets: "",
          releaseName: "",
          releaseNotes: "",
          releaseFilenames: "",
          workingDirectory: "/tmp",
          assumeAnswer: "yes"
        }
      };

      mockOctokit.rest.repos.createRelease.mockResolvedValue({
        data: { id: 123, html_url: "https://example.com" }
      });

      const result = await createRelease(context);

      expect(result.release.prerelease).toBe(true);
      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ prerelease: true })
      );
    });

    it("should handle context validation", async () => {
      await expect(createRelease({})).rejects.toThrow(
        "Context must have inputs populated"
      );
    });

    it("should handle release creation errors", async () => {
      const context = {
        inputs: {
          releases: true,
          assets: "",
          releaseName: "",
          releaseNotes: "",
          releaseFilenames: "",
          workingDirectory: "/tmp",
          assumeAnswer: "yes"
        }
      };

      mockOctokit.rest.repos.createRelease.mockRejectedValue(
        new Error("API Error")
      );

      await expect(createRelease(context)).rejects.toThrow(
        "Failed to create release: API Error"
      );
    });
  });
});