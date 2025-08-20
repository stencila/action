// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";

import { createCoreMock } from "./helpers/mock-actions.js";

// Create the mock at the top level to ensure proper hoisting
const coreMock = createCoreMock();

// Mock the @actions/core module using vi.mock (hoisted)
vi.mock("@actions/core", () => coreMock);

// Import after mocking to ensure the mock is applied
const { parseInputs } = await import("../src/inputs.js");

describe("inputs.js", () => {
  beforeEach(() => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    // Clear all input values for fresh start
    coreMock.clearInputValues();
  });

  describe("parseInputs", () => {
    it("should parse inputs with defaults", () => {
      const context = {};

      // Set default values for boolean inputs to empty strings (which should default to false)
      coreMock.setInputValue("cache", "");
      coreMock.setInputValue("install-tools", "");
      coreMock.setInputValue("continue-on-error", "");

      const result = parseInputs(context);

      expect(result).toBe(context); // Should return same context
      expect(context.inputs).toBeDefined();
      expect(context.inputs.version).toBe("latest");
      expect(context.inputs.workingDirectory).toBe(".");
      expect(context.inputs.artifactName).toBe("assets");
      expect(context.inputs.assumeAnswer).toBe("yes");
      expect(context.inputs.cache).toBe(false);
      expect(context.inputs.continueOnError).toBe(false);
      expect(context.inputs.releases).toBe(false);
    });

    it("should parse all provided inputs", () => {
      const context = {};

      // Set up all input values using the helper
      coreMock.setInputValue("version", "v2.0.0");
      coreMock.setInputValue("run", "stencila --version");
      coreMock.setInputValue("convert", "input.md output.html");
      coreMock.setInputValue("lint", "*.md");
      coreMock.setInputValue("execute", "notebook.ipynb");
      coreMock.setInputValue("render", "document.md");
      coreMock.setInputValue("assets", "**/*.html");
      coreMock.setInputValue("releases", "true");
      coreMock.setInputValue("release-name", "Release {{ tag }}");
      coreMock.setInputValue("release-notes", "Auto-generated release");
      coreMock.setInputValue("release-filenames", "{{ name }}-{{ version }}");
      coreMock.setInputValue("working-directory", "./src");
      coreMock.setInputValue("artifact-name", "my-artifacts");
      coreMock.setInputValue("assume-answer", "no");
      coreMock.setInputValue("cache", "true");
      coreMock.setInputValue("install-tools", "true");
      coreMock.setInputValue("continue-on-error", "true");

      parseInputs(context);

      expect(context.inputs.version).toBe("v2.0.0");
      expect(context.inputs.run).toBe("stencila --version");
      expect(context.inputs.convert).toBe("input.md output.html");
      expect(context.inputs.lint).toBe("*.md");
      expect(context.inputs.execute).toBe("notebook.ipynb");
      expect(context.inputs.render).toBe("document.md");
      expect(context.inputs.assets).toBe("**/*.html");
      expect(context.inputs.releases).toBe(true);
      expect(context.inputs.releaseName).toBe("Release {{ tag }}");
      expect(context.inputs.releaseNotes).toBe("Auto-generated release");
      expect(context.inputs.releaseFilenames).toBe("{{ name }}-{{ version }}");
      expect(context.inputs.workingDirectory).toBe("./src");
      expect(context.inputs.artifactName).toBe("my-artifacts");
      expect(context.inputs.assumeAnswer).toBe("no");
      expect(context.inputs.cache).toBe(true);
      expect(context.inputs.installTools).toBe(true);
      expect(context.inputs.continueOnError).toBe(true);
    });

    it("should parse releases as glob pattern when not boolean", () => {
      const context = {};

      coreMock.setInputValue("releases", "**/*.tar.gz");

      parseInputs(context);

      expect(context.inputs.releases).toBe("**/*.tar.gz");
    });

    it("should handle releases=false correctly", () => {
      const context = {};

      coreMock.setInputValue("releases", "false");

      parseInputs(context);

      expect(context.inputs.releases).toBe(false);
    });

    it("should trim all string inputs", () => {
      const context = {};

      coreMock.setInputValue("version", "  v2.0.0  ");
      coreMock.setInputValue("run", "  stencila --version  ");
      coreMock.setInputValue("working-directory", "  ./src  ");

      parseInputs(context);

      expect(context.inputs.version).toBe("v2.0.0");
      expect(context.inputs.run).toBe("stencila --version");
      expect(context.inputs.workingDirectory).toBe("./src");
    });

    it("should normalize assume-answer to lowercase", () => {
      const context = {};

      coreMock.setInputValue("assume-answer", "YES");

      parseInputs(context);

      expect(context.inputs.assumeAnswer).toBe("yes");
    });

    it("should validate version format", () => {
      const context = {};

      coreMock.setInputValue("version", "invalid-version");

      expect(() => parseInputs(context)).toThrow(
        "Invalid version format: invalid-version"
      );
    });

    it("should allow valid version formats", () => {
      const validVersions = [
        "latest",
        "v1.0.0",
        "2.0.0",
        "v1.0.0-beta",
        "v1.0.0-rc.1",
      ];

      for (const version of validVersions) {
        const context = {};
        coreMock.setInputValue("version", version);

        expect(() => parseInputs(context)).not.toThrow();
        expect(context.inputs.version).toBe(version);
      }
    });

    it("should validate assume-answer value", () => {
      const context = {};

      coreMock.setInputValue("assume-answer", "maybe");

      expect(() => parseInputs(context)).toThrow(
        "Invalid assume-answer value: maybe"
      );
    });

    it("should validate artifact-name format", () => {
      const context = {};

      coreMock.setInputValue("artifact-name", "invalid/name");

      expect(() => parseInputs(context)).toThrow(
        "Invalid artifact-name: invalid/name"
      );
    });

    it("should allow valid artifact-name formats", () => {
      const validNames = [
        "assets",
        "my-artifacts",
        "build_output",
        "v1.0.0-artifacts",
        "test.results",
      ];

      for (const name of validNames) {
        const context = {};
        coreMock.setInputValue("artifact-name", name);

        expect(() => parseInputs(context)).not.toThrow();
        expect(context.inputs.artifactName).toBe(name);
      }
    });

    it("should prevent path traversal in working-directory", () => {
      const context = {};

      coreMock.setInputValue("working-directory", "../escape");

      expect(() => parseInputs(context)).toThrow(
        "Invalid working-directory: ../escape"
      );
    });

    it("should handle render input with multiple lines", () => {
      const context = {};

      coreMock.setInputValue("render", "file1.md\nfile2.md\nfile3.md");

      parseInputs(context);

      // The inputs module just stores the raw value
      // The runner module will handle splitting for multi-line render
      expect(context.inputs.render).toBe("file1.md\nfile2.md\nfile3.md");
    });
  });
});
