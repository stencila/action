// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";

import { createCoreMock, createExecMock } from "./helpers/mock-actions.js";

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
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

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
    it("should write problem matcher file and register it", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Mock that directory doesn't exist initially
      vi.mocked(fs.existsSync).mockReturnValue(false);

      registerProblemMatcher();

      // Verify temp directory creation
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("stencila-action"),
        { recursive: true }
      );

      // Verify matcher file written
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("stencila-lint-matcher.json"),
        expect.stringContaining("stencila-lint")
      );

      // Verify matcher registration
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("::add-matcher::")
      );

      consoleSpy.mockRestore();
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
  });

  describe("executeCommand", () => {
    it("should execute command successfully", async () => {
      const commandSpec = { command: "convert", args: "doc.md --to html" };

      // Mock successful execution
      execMock.exec.mockImplementation((cmd, args, options) => {
        // Simulate stdout output
        if (options.listeners && options.listeners.stdout) {
          options.listeners.stdout(Buffer.from("Converting document..."));
          options.listeners.stdout(Buffer.from("Done"));
        }
        return Promise.resolve(0);
      });

      const result = await executeCommand(commandSpec, "/tmp", "yes");

      expect(result).toEqual({
        exitCode: 0,
        stdout: "Converting document...Done",
        stderr: "",
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
      execMock.exec.mockImplementation((cmd, args, options) => {
        // Simulate stderr output
        if (options.listeners && options.listeners.stderr) {
          options.listeners.stderr(Buffer.from("Error: File not found"));
        }
        return Promise.resolve(1);
      });

      const result = await executeCommand(commandSpec, "/tmp", "yes");

      expect(result).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "Error: File not found",
      });
    });

    it("should handle execution timeout", async () => {
      const commandSpec = { command: "execute", args: "slow.ipynb" };

      // Mock slow execution that never resolves
      execMock.exec.mockImplementation(() => {
        return new Promise(() => {}); // Never resolves
      });

      // Use short timeout for testing
      const originalTimeout = 10 * 60 * 1000;
      const shortTimeout = 100; // 100ms

      // Temporarily replace the timeout constant by mocking setTimeout
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn((callback, delay) => {
        if (delay === originalTimeout) {
          // Replace with short timeout for testing
          return originalSetTimeout(callback, shortTimeout);
        }
        return originalSetTimeout(callback, delay);
      });

      await expect(executeCommand(commandSpec, "/tmp", "yes")).rejects.toThrow(
        "Command timed out after 600 seconds"
      );

      global.setTimeout = originalSetTimeout;
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
        stderr: "Command not found",
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
