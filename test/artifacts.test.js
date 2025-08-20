// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

import { createCoreMock } from "./helpers/mock-actions.js";

// Create the mocks at the top level
const coreMock = createCoreMock();

// Mock dependencies
vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/glob", () => ({
  create: vi.fn()
}));
vi.mock("@actions/artifact", () => ({
  DefaultArtifactClient: vi.fn()
}));
vi.mock("fs");

// Import the module after mocking
const { uploadArtifacts, validateFiles, formatBytes } = await import("../src/artifacts.js");

describe("artifacts.js", () => {
  let mockGlobber;
  let mockArtifactClient;

  beforeEach(async () => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();

    // Create mock globber
    mockGlobber = {
      glob: vi.fn()
    };

    // Create mock artifact client
    mockArtifactClient = {
      uploadArtifact: vi.fn()
    };

    // Set up glob mock
    const { create } = await import("@actions/glob");
    vi.mocked(create).mockResolvedValue(mockGlobber);

    // Set up artifact client mock
    const { DefaultArtifactClient } = await import("@actions/artifact");
    vi.mocked(DefaultArtifactClient).mockImplementation(() => mockArtifactClient);

    // Set up default fs mocks
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      size: 1024
    });
  });

  describe("formatBytes", () => {
    it("should format bytes correctly", () => {
      expect(formatBytes(0)).toBe("0 Bytes");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1024 * 1024)).toBe("1 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });
  });

  describe("validateFiles", () => {
    it("should validate normal files", async () => {
      const files = ["/tmp/file1.txt", "/tmp/file2.txt"];
      
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      });

      const result = await validateFiles(files, "/tmp");

      expect(result).toEqual(files);
    });

    it("should skip hidden files", async () => {
      const files = ["/tmp/file1.txt", "/tmp/.hidden", "/tmp/dir/.hidden2"];
      
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      });

      const result = await validateFiles(files, "/tmp");

      expect(result).toEqual(["/tmp/file1.txt"]);
    });

    it("should skip directories", async () => {
      const files = ["/tmp/file1.txt", "/tmp/directory"];
      
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({
          isDirectory: () => false,
          size: 1024
        })
        .mockReturnValueOnce({
          isDirectory: () => true,
          size: 4096
        });

      const result = await validateFiles(files, "/tmp");

      expect(result).toEqual(["/tmp/file1.txt"]);
    });

    it("should skip files that are too large", async () => {
      const files = ["/tmp/small.txt", "/tmp/huge.bin"];
      
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({
          isDirectory: () => false,
          size: 1024
        })
        .mockReturnValueOnce({
          isDirectory: () => false,
          size: 600 * 1024 * 1024 // 600MB > 500MB limit
        });

      const result = await validateFiles(files, "/tmp");

      expect(result).toEqual(["/tmp/small.txt"]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Skipping file too large")
      );
    });

    it("should skip files with paths too long", async () => {
      const shortPath = "/tmp/file.txt";
      const longPath = "/tmp/" + "a".repeat(300) + ".txt";
      const files = [shortPath, longPath];
      
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      });

      const result = await validateFiles(files, "/tmp");

      expect(result).toEqual([shortPath]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Skipping file with path too long")
      );
    });

    it("should handle file stat errors gracefully", async () => {
      const files = ["/tmp/good.txt", "/tmp/error.txt"];
      
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({
          isDirectory: () => false,
          size: 1024
        })
        .mockImplementationOnce(() => {
          throw new Error("Permission denied");
        });

      const result = await validateFiles(files, "/tmp");

      expect(result).toEqual(["/tmp/good.txt"]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Skipping file due to error")
      );
    });

    it("should enforce total size limit", async () => {
      const files = Array.from({ length: 10 }, (_, i) => `/tmp/file${i}.txt`);
      
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 200 * 1024 * 1024 // 200MB each, total would be 2GB
      });

      const result = await validateFiles(files, "/tmp");

      // Should stop at 5 files (1GB total)
      expect(result.length).toBeLessThan(10);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("total size limit reached")
      );
    });
  });

  describe("uploadArtifacts", () => {
    let context;

    beforeEach(() => {
      context = {
        inputs: {
          assets: "*.txt",
          artifactName: "test-artifacts",
          workingDirectory: "/tmp"
        },
        results: [{ exitCode: 0 }]
      };
    });

    it("should upload artifacts successfully", async () => {
      const files = ["/tmp/file1.txt", "/tmp/file2.txt"];
      mockGlobber.glob.mockResolvedValue(files);
      
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      });

      mockArtifactClient.uploadArtifact.mockResolvedValue({
        id: 123,
        size: 2048
      });

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toHaveLength(1);
      expect(context.artifacts[0]).toMatchObject({
        name: "test-artifacts",
        files: ["file1.txt", "file2.txt"],
        size: 2048
      });

      expect(mockArtifactClient.uploadArtifact).toHaveBeenCalledWith(
        "test-artifacts",
        files,
        "/tmp",
        {
          retentionDays: 90,
          compressionLevel: 6
        }
      );

      expect(coreMock.info).toHaveBeenCalledWith(
        expect.stringContaining("Successfully uploaded artifact")
      );
    });

    it("should skip upload when no assetsPath specified", async () => {
      context.inputs.assets = "";

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toEqual([]);
      expect(coreMock.info).toHaveBeenCalledWith(
        "ℹ️ No assets path specified, skipping artifact upload"
      );
    });

    it("should skip upload when commands failed", async () => {
      context.results = [{ exitCode: 1 }];

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toEqual([]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        "⚠️ Skipping artifact upload due to command failures"
      );
    });

    it("should handle no files found", async () => {
      mockGlobber.glob.mockResolvedValue([]);

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toEqual([]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("No valid files found matching pattern")
      );
    });

    it("should handle upload errors gracefully", async () => {
      const files = ["/tmp/file1.txt"];
      mockGlobber.glob.mockResolvedValue(files);
      
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
        size: 1024
      });

      mockArtifactClient.uploadArtifact.mockRejectedValue(new Error("Upload failed"));

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toEqual([]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        expect.stringContaining("Failed to upload artifacts")
      );
    });

    it("should validate context requirements", async () => {
      await expect(uploadArtifacts({})).rejects.toThrow(
        "Context must have inputs populated"
      );

      await expect(uploadArtifacts({ inputs: {} })).rejects.toThrow(
        "Context must have command results"
      );
    });

    it("should configure globber with correct options", async () => {
      mockGlobber.glob.mockResolvedValue([]);

      await uploadArtifacts(context);

      const { create } = await import("@actions/glob");
      expect(create).toHaveBeenCalledWith(
        "/tmp/*.txt",
        {
          followSymbolicLinks: false,
          implicitDescendants: false,
          omitBrokenSymbolicLinks: true
        }
      );
    });

    it("should handle mixed success and failed commands", async () => {
      context.results = [
        { exitCode: 0 },
        { exitCode: 1 },
        { exitCode: 0 }
      ];

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toEqual([]);
      expect(coreMock.warning).toHaveBeenCalledWith(
        "⚠️ Skipping artifact upload due to command failures"
      );
    });

    it("should filter out invalid files during validation", async () => {
      const files = [
        "/tmp/good.txt",
        "/tmp/.hidden",
        "/tmp/directory"
      ];
      mockGlobber.glob.mockResolvedValue(files);
      
      // Clear default mock and set up specific mocks for this test
      vi.mocked(fs.statSync).mockReset();
      
      // Mock fs.statSync calls - .hidden is filtered before stat, so only good.txt and directory
      vi.mocked(fs.statSync)
        .mockReturnValueOnce({
          isDirectory: () => false,
          size: 1024
        })
        .mockReturnValueOnce({
          isDirectory: () => true,
          size: 4096
        });

      mockArtifactClient.uploadArtifact.mockResolvedValue({
        id: 123,
        size: 1024
      });

      const result = await uploadArtifacts(context);

      expect(result).toBe(context);
      expect(context.artifacts).toHaveLength(1);
      expect(context.artifacts[0].files).toEqual(["good.txt"]);
      expect(mockArtifactClient.uploadArtifact).toHaveBeenCalledWith(
        "test-artifacts",
        ["/tmp/good.txt"],
        "/tmp",
        expect.any(Object)
      );
    });
  });
});