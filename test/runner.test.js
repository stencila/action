// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";

import { createCoreMock, createExecMock } from "./helpers/mock-actions.js";

import stencilaLintProblemMatcher from "../.github/stencila-lint.json";

// Create the mocks at the top level
const coreMock = createCoreMock();
const execMock = createExecMock();

// Mock all dependencies using vi.mock (hoisted)
vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/exec", () => execMock);

// Mock Node.js built-ins
vi.mock("fs");

// Import the module after mocking
const {
  runCommands,
  collectCommands,
  executeCommand,
  maskSecrets,
  registerProblemMatcher,
} = await import("../src/runner.js");

describe("runner.js", () => {
  beforeEach(() => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();

    // Set up default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Set up default exec mocks
    execMock.exec.mockResolvedValue(0);
  });

  describe("collectCommands", () => {
    it("should collect run command", () => {
      const inputs = {
        run: "convert document.md",
        convert: "",
        lint: "",
        execute: "",
        render: "",
      };

      const commands = collectCommands(inputs);

      expect(commands).toEqual([{ command: "convert", args: "document.md" }]);
    });

    it("should collect individual command inputs", () => {
      const inputs = {
        run: "",
        convert: "document.md --to html",
        lint: "*.py",
        execute: "notebook.ipynb",
        render: "",
      };

      const commands = collectCommands(inputs);

      expect(commands).toEqual([
        { command: "convert", args: "document.md --to html" },
        { command: "lint", args: "*.py" },
        { command: "execute", args: "notebook.ipynb" },
      ]);
    });

    it("should handle multi-line render commands", () => {
      const inputs = {
        run: "",
        convert: "",
        lint: "",
        execute: "",
        render: "template1.md\\ntemplate2.md\\n\\ntemplate3.md",
      };

      const commands = collectCommands(inputs);

      expect(commands).toEqual([
        { command: "render", args: "template1.md" },
        { command: "render", args: "template2.md" },
        { command: "render", args: "template3.md" },
      ]);
    });

    it("should return empty array when no commands", () => {
      const inputs = {
        run: "",
        convert: "",
        lint: "",
        execute: "",
        render: "",
      };

      const commands = collectCommands(inputs);

      expect(commands).toEqual([]);
    });

    it("should handle combined run and individual commands", () => {
      const inputs = {
        run: "convert doc.md",
        convert: "",
        lint: "*.py",
        execute: "",
        render: "",
      };

      const commands = collectCommands(inputs);

      expect(commands).toEqual([
        { command: "convert", args: "doc.md" },
        { command: "lint", args: "*.py" },
      ]);
    });
  });

  describe("maskSecrets", () => {
    it("should mask common secret patterns", () => {
      const text =
        "GITHUB_TOKEN=ghp_1234567890 API_KEY=secret123 PASSWORD=mypass";
      const masked = maskSecrets(text);

      expect(masked).toBe("*** *** ***");
    });

    it("should mask environment variable assignments", () => {
      const text = "Setting SECRET_TOKEN=abc123 and API_SECRET=xyz789";
      const masked = maskSecrets(text);

      expect(masked).toBe("Setting *** and ***");
    });

    it("should preserve non-secret text", () => {
      const text = "Converting document.md to HTML format";
      const masked = maskSecrets(text);

      expect(masked).toBe("Converting document.md to HTML format");
    });

    it("should handle empty text", () => {
      const text = "";
      const masked = maskSecrets(text);

      expect(masked).toBe("");
    });

    it("should mask case-insensitive patterns", () => {
      const text = "github_token=abc Token=xyz secret=123";
      const masked = maskSecrets(text);

      expect(masked).toBe("*** *** ***");
    });
  });

  describe("registerProblemMatcher", () => {
    it("should register static problem matcher file", () => {
      // Mock that the static matcher file exists
      vi.mocked(fs.existsSync).mockReturnValue(true);

      registerProblemMatcher();

      // Verify it checks for the static file
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining(".github/stencila-lint.json")
      );

      // Verify matcher registration
      expect(coreMock.info).toHaveBeenCalledWith(
        expect.stringContaining("#[add-matcher]")
      );
    });

    it("should handle errors gracefully", () => {
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      registerProblemMatcher();

      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Failed to register problem matcher")
      );
    });

    it("should handle missing static matcher file", () => {
      // Mock that the static matcher file doesn't exist
      vi.mocked(fs.existsSync).mockReturnValue(false);

      registerProblemMatcher();

      // Verify warning is logged
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Problem matcher file not found")
      );

      // Verify no registration attempt
      expect(coreMock.info).not.toHaveBeenCalledWith(
        expect.stringContaining("##[add-matcher]")
      );
    });

    it("should verify static matcher file patterns", () => {
      // Use the imported matcher patterns
      const patterns = stencilaLintProblemMatcher.problemMatcher[0].pattern;

      // Test actual Stencila lint output - plain (GitHub Actions)
      const plainOutput = `Error: Citation error 
   ╭─[ test-lint.smd:3:33 ]
   │
 3 │ Citing a non existent reference [@foo].
   │                                 ───┬──  
   │                                    ╰──── Unable to resolve citation target \`foo\`
───╯`;

      const plainLines = plainOutput.split("\n");

      // Test severity pattern
      const severityPattern = new RegExp(patterns[0].regexp);
      const severityLine = plainLines[0];
      expect(severityPattern.test(severityLine)).toBe(true);
      const severityMatch = severityLine.match(severityPattern);
      expect(severityMatch?.[1]).toBe("Error");

      // Test file location pattern
      const filePattern = new RegExp(patterns[1].regexp);
      const fileLine = plainLines[1];
      expect(filePattern.test(fileLine)).toBe(true);
      const fileMatch = fileLine.match(filePattern);
      expect(fileMatch?.[1]).toBe("test-lint.smd");
      expect(fileMatch?.[2]).toBe("3");
      expect(fileMatch?.[3]).toBe("33");

      // Also test with ANSI color codes (local dev)
      const coloredOutput = `[31mError:[0m Citation error`;
      expect(severityPattern.test(coloredOutput)).toBe(true);
      const coloredMatch = coloredOutput.match(severityPattern);
      expect(coloredMatch?.[1]).toBe("Error");
    });

    it("should match Warning severity as well", () => {
      const patterns = stencilaLintProblemMatcher.problemMatcher[0].pattern;
      const severityPattern = new RegExp(patterns[0].regexp);

      // Test plain warning
      const plainWarning = `Warning: Python CodeChunk Linting warning`;
      expect(severityPattern.test(plainWarning)).toBe(true);
      const plainMatch = plainWarning.match(severityPattern);
      expect(plainMatch?.[1]).toBe("Warning");

      // Test colored warning
      const coloredWarning = `[33mWarning:[0m Python CodeChunk Linting warning`;
      expect(severityPattern.test(coloredWarning)).toBe(true);
      const coloredMatch = coloredWarning.match(severityPattern);
      expect(coloredMatch?.[1]).toBe("Warning");
    });
  });

  describe("executeCommand", () => {
    it("should execute command successfully", async () => {
      const commandSpec = { command: "convert", args: "doc.md --to html" };

      // Mock successful execution
      execMock.exec.mockResolvedValue(0);

      const result = await executeCommand(commandSpec, "/tmp", "yes");

      expect(result).toEqual({
        exitCode: 0,
      });

      expect(execMock.exec).toHaveBeenCalledWith(
        "stencila",
        ["convert", "doc.md", "--to", "html", "--yes"],
        expect.objectContaining({
          cwd: "/tmp",
          ignoreReturnCode: true,
        })
      );
    });

    it("should handle command failure", async () => {
      const commandSpec = { command: "lint", args: "invalid.py" };

      // Mock failed execution
      execMock.exec.mockResolvedValue(1);

      const result = await executeCommand(commandSpec, "/tmp", "yes");

      expect(result).toEqual({
        exitCode: 1,
      });
    });

    it("should handle execution errors", async () => {
      const commandSpec = { command: "execute", args: "invalid.ipynb" };

      // Mock execution that throws error
      execMock.exec.mockRejectedValue(new Error("Command not found"));

      await expect(executeCommand(commandSpec, "/tmp", "yes")).rejects.toThrow(
        "Command not found"
      );
    });

    it("should handle no args", async () => {
      const commandSpec = { command: "version", args: "" };

      execMock.exec.mockResolvedValue(0);

      await executeCommand(commandSpec, "/tmp", "yes");

      expect(execMock.exec).toHaveBeenCalledWith(
        "stencila",
        ["version", "--yes"],
        expect.any(Object)
      );
    });
  });

  describe("runCommands", () => {
    let context;

    beforeEach(() => {
      context = {
        inputs: {
          run: "convert doc.md",
          convert: "",
          lint: "",
          execute: "",
          render: "",
          workingDirectory: "/tmp",
          continueOnError: false,
          assumeAnswer: "yes",
        },
        stencila: {
          version: "v2.0.0",
          resolvedVersion: "v2.0.0",
          binaryPath: "/usr/local/bin/stencila",
          wasAlreadyInstalled: false,
          downloadUrl: "https://example.com/stencila",
          checksumVerified: true,
          installDuration: 1000,
        },
      };
    });

    it("should run commands successfully", async () => {
      execMock.exec.mockResolvedValue(0);

      const result = await runCommands(context);

      expect(result).toBe(context);
      expect(context.results).toHaveLength(1);
      expect(context.results[0]).toMatchObject({
        command: "stencila convert doc.md",
        exitCode: 0,
        duration: expect.any(Number),
      });

      expect(coreMock.info).toHaveBeenCalledWith(
        "⚡ Executing 1 command(s)..."
      );
      expect(coreMock.info).toHaveBeenCalledWith(
        expect.stringContaining("✅ Command 1 completed successfully")
      );
      expect(coreMock.setOutput).toHaveBeenCalledWith("exit-code", "0");
    });

    it("should handle command failure with continueOnError false", async () => {
      execMock.exec.mockResolvedValue(1);

      const result = await runCommands(context);

      expect(result).toBe(context);
      expect(context.results).toHaveLength(1);
      expect(context.results[0].exitCode).toBe(1);
      expect(coreMock.error).toHaveBeenCalledWith(
        expect.stringContaining("❌ Command 1 failed with exit code 1")
      );
      expect(coreMock.setFailed).toHaveBeenCalledWith(
        "Stencila command failed with exit code 1"
      );
    });

    it("should continue on error when continueOnError is true", async () => {
      context.inputs.continueOnError = true;
      context.inputs.lint = "invalid.py"; // Add second command

      execMock.exec
        .mockResolvedValueOnce(1) // First command fails
        .mockResolvedValueOnce(0); // Second command succeeds

      const result = await runCommands(context);

      expect(result).toBe(context);
      expect(context.results).toHaveLength(2);
      expect(context.results[0].exitCode).toBe(1);
      expect(context.results[1].exitCode).toBe(0);

      expect(coreMock.error).toHaveBeenCalledWith(
        expect.stringContaining("❌ Command 1 failed with exit code 1")
      );
      expect(coreMock.info).toHaveBeenCalledWith(
        expect.stringContaining("✅ Command 2 completed successfully")
      );
      expect(coreMock.setFailed).toHaveBeenCalledWith(
        "One or more Stencila commands failed"
      );
    });

    it("should handle execution errors", async () => {
      context.inputs.continueOnError = true; // Allow the function to continue
      execMock.exec.mockRejectedValue(new Error("Command not found"));

      const result = await runCommands(context);

      expect(result).toBe(context);
      expect(context.results).toHaveLength(1);
      expect(context.results[0]).toMatchObject({
        command: "stencila convert doc.md",
        exitCode: -1,
      });
    });

    it("should handle no commands gracefully", async () => {
      context.inputs.run = "";

      const result = await runCommands(context);

      expect(result).toBe(context);
      expect(context.results).toEqual([]);
      expect(coreMock.info).toHaveBeenCalledWith("ℹ️ No commands to run");
      expect(execMock.exec).not.toHaveBeenCalled();
    });

    it("should validate required context properties", async () => {
      await expect(runCommands({})).rejects.toThrow(
        "Context must have inputs populated"
      );

      await expect(runCommands({ inputs: {} })).rejects.toThrow(
        "Context must have stencila info populated"
      );
    });

    it("should register problem matcher", async () => {
      execMock.exec.mockResolvedValue(0);

      await runCommands(context);

      expect(coreMock.info).toHaveBeenCalledWith(
        expect.stringContaining("🔍 Registering problem matcher")
      );
    });

    it("should handle multiple commands", async () => {
      context.inputs.convert = "doc1.md";
      context.inputs.lint = "*.py";
      context.inputs.execute = "notebook.ipynb";

      execMock.exec.mockResolvedValue(0);

      const result = await runCommands(context);

      expect(result).toBe(context);
      expect(context.results).toHaveLength(4); // run + convert + lint + execute
      expect(execMock.exec).toHaveBeenCalledTimes(4);
      expect(coreMock.info).toHaveBeenCalledWith(
        "⚡ Executing 4 command(s)..."
      );
    });
  });
});
