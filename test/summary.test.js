// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";

import { createCoreMock } from "./helpers/mock-actions.js";

// Create the mocks at the top level
const coreMock = createCoreMock();

// Mock summary builder
const mockSummary = {
  addHeading: vi.fn().mockReturnThis(),
  addList: vi.fn().mockReturnThis(),
  addTable: vi.fn().mockReturnThis(),
  addRaw: vi.fn().mockReturnThis(),
  addImage: vi.fn().mockReturnThis(),
  write: vi.fn().mockResolvedValue(undefined)
};

// Mock dependencies
vi.mock("@actions/core", () => ({
  ...coreMock,
  summary: mockSummary
}));

// Import the module after mocking
const { publishSummary, formatBytes } = await import("../src/summary.js");

describe("summary.js", () => {
  beforeEach(() => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();
    
    // Reset summary mock return values
    mockSummary.addHeading.mockReturnThis();
    mockSummary.addList.mockReturnThis();
    mockSummary.addTable.mockReturnThis();
    mockSummary.addRaw.mockReturnThis();
    mockSummary.addImage.mockReturnThis();
    mockSummary.write.mockResolvedValue(undefined);
  });

  describe("formatBytes", () => {
    it("should format bytes correctly", () => {
      expect(formatBytes(0)).toBe("0 Bytes");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(1073741824)).toBe("1 GB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });
  });

  describe("publishSummary", () => {
    it("should create basic summary with minimal context", async () => {
      const context = {};

      const result = await publishSummary(context);

      expect(result).toBe(context);
      expect(mockSummary.addRaw).toHaveBeenCalledWith("# <img src=https://stencila.io/web/v2.5.1/images/favicon.png width=32 height=32> Stencila Action Summary");
      expect(mockSummary.addHeading).toHaveBeenCalledWith("⚙️ Setup", 2);
      expect(mockSummary.write).toHaveBeenCalled();
    });

    it("should include Stencila setup information", async () => {
      const context = {
        stencila: {
          resolvedVersion: "1.0.0",
          wasAlreadyInstalled: true,
          installDuration: 2500
        },
        env: {
          platform: "linux",
          arch: "x64"
        }
      };

      await publishSummary(context);

      expect(mockSummary.addRaw).toHaveBeenCalledWith(
        "**Stencila Version:** 1.0.0 🟢 Cached (2.5s)\n**Platform:** linux-x64"
      );
    });

    it("should include cache information", async () => {
      const context = {
        cache: {
          wasRestored: false
        }
      };

      await publishSummary(context);

      expect(mockSummary.addRaw).toHaveBeenCalledWith("**Cache:** 🟡 Miss");
    });

    it("should include tools installation status", async () => {
      const context = {
        toolsInstalled: {
          success: true
        }
      };

      await publishSummary(context);

      expect(mockSummary.addRaw).toHaveBeenCalledWith("**Tools Installed:** ✅ Success");
    });

    it("should create commands table when commands were executed", async () => {
      const context = {
        results: [
          {
            command: "stencila convert document.md",
            exitCode: 0,
            duration: 2300
          },
          {
            command: "stencila lint document.md",
            exitCode: 1,
            duration: 1200
          }
        ]
      };

      await publishSummary(context);

      expect(mockSummary.addHeading).toHaveBeenCalledWith("🚀 Commands Executed", 2);
      expect(mockSummary.addTable).toHaveBeenCalledWith([
        [
          { data: "Command", header: true },
          { data: "Status", header: true },
          { data: "Duration", header: true },
          { data: "Exit Code", header: true }
        ],
        [
          { data: "stencila convert document.md", header: false },
          { data: "✅ Success", header: false },
          { data: "2.3s", header: false },
          { data: "0", header: false }
        ],
        [
          { data: "stencila lint document.md", header: false },
          { data: "❌ Failed", header: false },
          { data: "1.2s", header: false },
          { data: "1", header: false }
        ]
      ]);
      expect(mockSummary.addRaw).toHaveBeenCalledWith(
        "\n**Summary:** 1/2 commands succeeded, 1 failed."
      );
    });

    it("should show success message when all commands succeed", async () => {
      const context = {
        results: [
          { command: "stencila convert", exitCode: 0, duration: 1000 },
          { command: "stencila lint", exitCode: 0, duration: 500 }
        ]
      };

      await publishSummary(context);

      expect(mockSummary.addRaw).toHaveBeenCalledWith(
        "\n**Summary:** All 2 commands succeeded! 🎉"
      );
    });

    it("should include artifacts information", async () => {
      const context = {
        artifacts: [
          {
            name: "build-artifacts",
            files: ["index.html", "styles.css", "script.js"],
            size: 1536000
          }
        ]
      };

      await publishSummary(context);

      expect(mockSummary.addHeading).toHaveBeenCalledWith("📦 Artifacts", 2);
      expect(mockSummary.addRaw).toHaveBeenCalledWith("**`build-artifacts`:** 3 files, 1.46 MB");
    });

    it("should include release information for regular release", async () => {
      const context = {
        release: {
          tag: "v1.0.0",
          name: "Version 1.0.0",
          prerelease: false,
          assets: ["binary-linux", "binary-windows", "binary-macos"]
        }
      };

      await publishSummary(context);

      expect(mockSummary.addHeading).toHaveBeenCalledWith("🏷️ Release", 2);
      expect(mockSummary.addRaw).toHaveBeenCalledWith(
        "**Tag:** v1.0.0\n**Name:** Version 1.0.0\n**Type:** 🚀 Release\n**Assets:** 3 files uploaded"
      );
    });

    it("should include release information for prerelease", async () => {
      const context = {
        release: {
          tag: "v1.0.0-beta.1",
          name: "Beta Release",
          prerelease: true,
          assets: []
        }
      };

      await publishSummary(context);

      expect(mockSummary.addRaw).toHaveBeenCalledWith(
        "**Tag:** v1.0.0-beta.1\n**Name:** Beta Release\n**Type:** 🚧 Pre-release"
      );
    });

    it("should include errors information", async () => {
      const context = {
        errors: [
          new Error("File not found"),
          new Error("Permission denied")
        ]
      };

      await publishSummary(context);

      expect(mockSummary.addHeading).toHaveBeenCalledWith("⚠️ Issues", 2);
      expect(mockSummary.addList).toHaveBeenCalledWith([
        "❌ File not found",
        "❌ Permission denied"
      ], false);
    });

    it("should handle comprehensive context with all sections", async () => {
      const context = {
        stencila: {
          resolvedVersion: "1.2.0",
          wasAlreadyInstalled: false,
          installDuration: 5000
        },
        env: {
          platform: "darwin",
          arch: "arm64"
        },
        cache: {
          wasRestored: true
        },
        toolsInstalled: {
          success: true
        },
        results: [
          { command: "stencila convert", exitCode: 0, duration: 2000 }
        ],
        artifacts: [
          { name: "docs", files: ["doc.html"], size: 2048 }
        ],
        release: {
          tag: "v1.2.0",
          name: "Release 1.2.0",
          prerelease: false,
          assets: ["asset1"]
        }
      };

      await publishSummary(context);

      // Should have all section headings
      expect(mockSummary.addRaw).toHaveBeenCalledWith("# <img src=https://stencila.io/web/v2.5.1/images/favicon.png width=32 height=32> Stencila Action Summary");
      expect(mockSummary.addHeading).toHaveBeenCalledWith("⚙️ Setup", 2);
      expect(mockSummary.addHeading).toHaveBeenCalledWith("🚀 Commands Executed", 2);
      expect(mockSummary.addHeading).toHaveBeenCalledWith("📦 Artifacts", 2);
      expect(mockSummary.addHeading).toHaveBeenCalledWith("🏷️ Release", 2);
    });

    it("should handle summary write errors gracefully", async () => {
      const context = {};
      mockSummary.write.mockRejectedValue(new Error("Summary write failed"));

      const result = await publishSummary(context);

      expect(result).toBe(context);
      expect(coreMock.warning).toHaveBeenCalledWith(
        "⚠️ Failed to publish summary: Summary write failed"
      );
    });

    it("should handle commands with missing duration", async () => {
      const context = {
        results: [
          {
            command: "stencila convert",
            exitCode: 0
            // No duration property
          }
        ]
      };

      await publishSummary(context);

      expect(mockSummary.addTable).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            { data: "stencila convert", header: false },
            { data: "✅ Success", header: false },
            { data: "N/A", header: false },
            { data: "0", header: false }
          ])
        ])
      );
    });

    it("should show no setup info message when context is empty", async () => {
      const context = {};

      await publishSummary(context);

      expect(mockSummary.addRaw).toHaveBeenCalledWith("No setup information available.");
    });
  });
});