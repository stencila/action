// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";

import { createCoreMock } from "./helpers/mock-actions.js";

// Create the mocks at the top level
const coreMock = createCoreMock();

// Mock dependencies
vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/exec", () => ({
  exec: vi.fn()
}));

// Import the module after mocking
const { installTools } = await import("../src/tools.js");

describe("tools.js", () => {
  let mockExec;

  beforeEach(async () => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();

    // Set up exec mock
    const exec = await import("@actions/exec");
    mockExec = vi.mocked(exec.exec);
  });

  describe("installTools", () => {
    it("should skip tool installation when disabled", async () => {
      const context = {
        inputs: {
          workingDirectory: "/tmp",
          installTools: false,
          assumeAnswer: "yes"
        }
      };

      const result = await installTools(context);

      expect(result).toBe(context);
      expect(mockExec).not.toHaveBeenCalled();
      expect(coreMock.debug).toHaveBeenCalledWith("🔧 Tool installation disabled, skipping");
    });

    it("should install tools successfully", async () => {
      const context = {
        inputs: {
          workingDirectory: "/tmp",
          installTools: true,
          assumeAnswer: "yes"
        }
      };

      mockExec.mockResolvedValue(0);

      const result = await installTools(context);

      expect(result).toBe(context);
      expect(result.toolsInstalled).toEqual({
        success: true,
        exitCode: 0
      });

      expect(mockExec).toHaveBeenCalledWith(
        "stencila",
        ["tools", "install", "--yes"],
        {
          cwd: "/tmp",
          ignoreReturnCode: true
        }
      );

      expect(coreMock.info).toHaveBeenCalledWith("🔧 Installing Stencila tools...");
      expect(coreMock.info).toHaveBeenCalledWith("✅ Tools installed successfully");
    });

    it("should handle tool installation failure", async () => {
      const context = {
        inputs: {
          workingDirectory: "/tmp",
          installTools: true,
          assumeAnswer: "yes"
        }
      };

      mockExec.mockResolvedValue(1);

      const result = await installTools(context);

      expect(result).toBe(context);
      expect(result.toolsInstalled).toEqual({
        success: false,
        exitCode: 1
      });

      expect(coreMock.warning).toHaveBeenCalledWith(
        "⚠️ Failed to install tools with exit code 1"
      );
    });

    it("should handle tool installation errors", async () => {
      const context = {
        inputs: {
          workingDirectory: "/tmp",
          installTools: true,
          assumeAnswer: "yes"
        }
      };

      mockExec.mockRejectedValue(new Error("Command not found"));

      const result = await installTools(context);

      expect(result).toBe(context);
      expect(result.toolsInstalled).toEqual({
        success: false,
        error: "Command not found"
      });

      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ Error installing tools: Command not found");
    });

    it("should handle different assume answer values", async () => {
      const context = {
        inputs: {
          workingDirectory: "/tmp",
          installTools: true,
          assumeAnswer: "no"
        }
      };

      mockExec.mockResolvedValue(0);

      await installTools(context);

      expect(mockExec).toHaveBeenCalledWith(
        "stencila",
        ["tools", "install", "--no"],
        expect.any(Object)
      );
    });

    it("should validate context requirements", async () => {
      await expect(installTools({})).rejects.toThrow(
        "Context must have inputs populated before installing tools"
      );
    });

    it("should use correct working directory", async () => {
      const context = {
        inputs: {
          workingDirectory: "/custom/path",
          installTools: true,
          assumeAnswer: "yes"
        }
      };

      mockExec.mockResolvedValue(0);

      await installTools(context);

      expect(mockExec).toHaveBeenCalledWith(
        "stencila",
        ["tools", "install", "--yes"],
        {
          cwd: "/custom/path",
          ignoreReturnCode: true
        }
      );
    });
  });
});