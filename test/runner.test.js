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

    it("should create patterns that match actual Stencila lint output", () => {
      let capturedMatcher;
      
      // Capture the matcher content when written
      vi.mocked(fs.writeFileSync).mockImplementation((path, content) => {
        if (typeof content === 'string') {
          capturedMatcher = JSON.parse(content);
        }
      });

      registerProblemMatcher();

      expect(capturedMatcher).toBeDefined();
      expect(capturedMatcher.owner).toBe("stencila-lint");
      expect(capturedMatcher.pattern).toHaveLength(3);

      // Test actual Stencila lint output patterns generated from
      // FORCE_COLOR=true stencila lint test-lint.smd
      const actualOutput = `[31mError:[0m Citation error 
   [38;5;246m╭[0m[38;5;246m─[0m[38;5;246m[[0m test-lint.smd:1:73 [38;5;246m][0m
   [38;5;246m│[0m
 [38;5;246m1 │[0m [38;5;249mA[0m[38;5;249m [0m[38;5;249ms[0m[38;5;249mm[0m[38;5;249ma[0m[38;5;249ml[0m[38;5;249ml[0m[38;5;249m [0m[38;5;249mt[0m[38;5;249me[0m[38;5;249ms[0m[38;5;249mt[0m[38;5;249m [0m[38;5;249md[0m[38;5;249mo[0m[38;5;249mc[0m[38;5;249mu[0m[38;5;249mm[0m[38;5;249me[0m[38;5;249mn[0m[38;5;249mt[0m[38;5;249m [0m[38;5;249mw[0m[38;5;249mi[0m[38;5;249mt[0m[38;5;249mh[0m[38;5;249m [0m[38;5;249ml[0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249mt[0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249mg[0m[38;5;249m [0m[38;5;249mw[0m[38;5;249ma[0m[38;5;249mr[0m[38;5;249mn[0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249mg[0m[38;5;249ms[0m[38;5;249m [0m[38;5;249ma[0m[38;5;249mn[0m[38;5;249md[0m[38;5;249m [0m[38;5;249me[0m[38;5;249mr[0m[38;5;249mr[0m[38;5;249mo[0m[38;5;249mr[0m[38;5;249ms[0m[38;5;249m [0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249mc[0m[38;5;249ml[0m[38;5;249mu[0m[38;5;249md[0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249mg[0m[38;5;249m [0m[38;5;249mc[0m[38;5;249mi[0m[38;5;249mt[0m[38;5;249mi[0m[38;5;249mn[0m[38;5;249mg[0m[38;5;249m [0m[@foo][38;5;249m.[0m
 [38;5;240m  │[0m                                                                         ───┬──  
 [38;5;240m  │[0m                                                                            ╰──── Unable to resolve citation target \`foo\`
[38;5;246m───╯[0m`;

      const lines = actualOutput.split('\n');

      // Test pattern 1: Should match severity line
      const severityPattern = new RegExp(capturedMatcher.pattern[0].regexp);
      expect(severityPattern.test(lines[0])).toBe(true);
      const severityMatch = lines[0].match(severityPattern);
      expect(severityMatch[1]).toBe("Error");

      // Test pattern 2: Should match file location
      const fileLocationPattern = new RegExp(capturedMatcher.pattern[1].regexp);
      let foundFileMatch = false;
      for (const line of lines) {
        if (fileLocationPattern.test(line)) {
          const match = line.match(fileLocationPattern);
          expect(match[1]).toBe("test-lint.smd");
          expect(match[2]).toBe("1");
          expect(match[3]).toBe("73");
          foundFileMatch = true;
          break;
        }
      }
      expect(foundFileMatch).toBe(true);

      // Test pattern 3: Should match detailed message
      const messagePattern = new RegExp(capturedMatcher.pattern[2].regexp);
      expect(messagePattern.test(lines[5])).toBe(true);
      const messageMatch = lines[5].match(messagePattern);
      expect(messageMatch[1]).toBe("Unable to resolve citation target `foo`");
    });

    it("should match Warning severity as well", () => {
      let capturedMatcher;
      
      vi.mocked(fs.writeFileSync).mockImplementation((path, content) => {
        if (typeof content === 'string') {
          capturedMatcher = JSON.parse(content);
        }
      });

      registerProblemMatcher();

      const warningOutput = `[33mWarning:[0m Python CodeChunk Linting warning`;
      const severityPattern = new RegExp(capturedMatcher.pattern[0].regexp);
      expect(severityPattern.test(warningOutput)).toBe(true);
      const match = warningOutput.match(severityPattern);
      expect(match[1]).toBe("Warning");
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
