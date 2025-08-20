// @ts-check

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";

import { createCoreMock } from "./helpers/mock-actions.js";

// Create the mocks at the top level
const coreMock = createCoreMock();

// Mock dependencies
vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/cache", () => ({
  restoreCache: vi.fn(),
  saveCache: vi.fn()
}));
vi.mock("fs");

// Import the module after mocking
const { restoreCache, saveCache } = await import("../src/cache.js");

describe("cache.js", () => {
  let mockCache;

  beforeEach(async () => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();

    // Set up cache mock
    const cache = await import("@actions/cache");
    mockCache = {
      restoreCache: vi.mocked(cache.restoreCache),
      saveCache: vi.mocked(cache.saveCache)
    };

    // Set up default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Mock environment variables
    process.env.GITHUB_SHA = "abc123def456";
  });

  describe("restoreCache", () => {
    it("should skip cache operations when caching is disabled", async () => {
      const context = {
        inputs: { cache: false, workingDirectory: "/tmp" },
        env: { platform: "linux", arch: "x64" },
        stencila: { resolvedVersion: "1.0.0" }
      };

      const result = await restoreCache(context);

      expect(result).toBe(context);
      expect(mockCache.restoreCache).not.toHaveBeenCalled();
      expect(coreMock.debug).toHaveBeenCalledWith("📦 Cache disabled, skipping cache operations");
    });

    it("should restore cache successfully", async () => {
      const context = {
        inputs: { cache: true, workingDirectory: "/tmp" },
        env: { platform: "linux", arch: "x64" },
        stencila: { resolvedVersion: "1.0.0" }
      };

      mockCache.restoreCache.mockResolvedValue("cache-hit-key");

      const result = await restoreCache(context);

      expect(result).toBe(context);
      expect(result.cache).toEqual({
        key: "stencila-cache-linux-x64-1.0.0-abc123def456",
        path: "/tmp/.stencila",
        wasRestored: true
      });

      expect(mockCache.restoreCache).toHaveBeenCalledWith(
        ["/tmp/.stencila"],
        "stencila-cache-linux-x64-1.0.0-abc123def456",
        [
          "stencila-cache-linux-x64-1.0.0-",
          "stencila-cache-linux-x64-"
        ]
      );

      expect(coreMock.info).toHaveBeenCalledWith(
        "🔄 Restoring .stencila cache with key: stencila-cache-linux-x64-1.0.0-abc123def456"
      );
      expect(coreMock.info).toHaveBeenCalledWith("✅ Cache restored from key: cache-hit-key");
    });

    it("should handle cache miss gracefully", async () => {
      const context = {
        inputs: { cache: true, workingDirectory: "/tmp" },
        env: { platform: "linux", arch: "x64" },
        stencila: { resolvedVersion: "1.0.0" }
      };

      mockCache.restoreCache.mockResolvedValue(null);

      const result = await restoreCache(context);

      expect(result).toBe(context);
      expect(result.cache).toEqual({
        key: "stencila-cache-linux-x64-1.0.0-abc123def456",
        path: "/tmp/.stencila",
        wasRestored: false
      });

      expect(coreMock.info).toHaveBeenCalledWith("ℹ️ No cache found, starting fresh");
    });

    it("should handle cache restore errors gracefully", async () => {
      const context = {
        inputs: { cache: true, workingDirectory: "/tmp" },
        env: { platform: "linux", arch: "x64" },
        stencila: { resolvedVersion: "1.0.0" }
      };

      mockCache.restoreCache.mockRejectedValue(new Error("Cache service unavailable"));

      const result = await restoreCache(context);

      expect(result).toBe(context);
      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ Failed to restore cache: Cache service unavailable");
    });

    it("should use default SHA when GITHUB_SHA is not available", async () => {
      delete process.env.GITHUB_SHA;

      const context = {
        inputs: { cache: true, workingDirectory: "/tmp" },
        env: { platform: "linux", arch: "x64" },
        stencila: { resolvedVersion: "1.0.0" }
      };

      mockCache.restoreCache.mockResolvedValue(null);

      const result = await restoreCache(context);

      expect(result.cache?.key).toBe("stencila-cache-linux-x64-1.0.0-default");
    });

    it("should validate context requirements", async () => {
      await expect(restoreCache({})).rejects.toThrow(
        "Context must have inputs populated before restoring cache"
      );

      await expect(restoreCache({ inputs: {} })).rejects.toThrow(
        "Context must have environment populated before restoring cache"
      );

      await expect(restoreCache({ inputs: {}, env: {} })).rejects.toThrow(
        "Context must have Stencila info populated before restoring cache"
      );
    });
  });

  describe("saveCache", () => {
    it("should skip save when caching is disabled", async () => {
      const context = {
        inputs: { cache: false }
      };

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(mockCache.saveCache).not.toHaveBeenCalled();
      expect(coreMock.debug).toHaveBeenCalledWith("📦 Cache disabled, skipping save");
    });

    it("should skip save when no cache info available", async () => {
      const context = {
        inputs: { cache: true }
      };

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(mockCache.saveCache).not.toHaveBeenCalled();
      expect(coreMock.debug).toHaveBeenCalledWith("📦 No cache info available, skipping save");
    });

    it("should skip save when no commands executed", async () => {
      const context = {
        inputs: { cache: true },
        cache: { key: "test-key", path: "/tmp/.stencila", wasRestored: false },
        results: []
      };

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(mockCache.saveCache).not.toHaveBeenCalled();
      expect(coreMock.debug).toHaveBeenCalledWith("📦 No commands executed, skipping cache save");
    });

    it("should skip save when cache path does not exist", async () => {
      const context = {
        inputs: { cache: true },
        cache: { key: "test-key", path: "/tmp/.stencila", wasRestored: false },
        results: [{ exitCode: 0 }]
      };

      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(mockCache.saveCache).not.toHaveBeenCalled();
      expect(coreMock.debug).toHaveBeenCalledWith("📦 Cache path does not exist: /tmp/.stencila");
    });

    it("should save cache successfully", async () => {
      const context = {
        inputs: { cache: true },
        cache: { key: "test-key", path: "/tmp/.stencila", wasRestored: false },
        results: [{ exitCode: 0 }]
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCache.saveCache.mockResolvedValue();

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(mockCache.saveCache).toHaveBeenCalledWith(["/tmp/.stencila"], "test-key");
      expect(coreMock.info).toHaveBeenCalledWith("💾 Saving .stencila cache with key: test-key");
      expect(coreMock.info).toHaveBeenCalledWith("✅ Cache saved successfully");
    });

    it("should handle cache already exists error", async () => {
      const context = {
        inputs: { cache: true },
        cache: { key: "test-key", path: "/tmp/.stencila", wasRestored: false },
        results: [{ exitCode: 0 }]
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      const error = new Error("Cache entry already exists");
      error.name = "ValidationError";
      mockCache.saveCache.mockRejectedValue(error);

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(coreMock.info).toHaveBeenCalledWith("ℹ️ Cache already exists, skipping save");
    });

    it("should handle other cache save errors", async () => {
      const context = {
        inputs: { cache: true },
        cache: { key: "test-key", path: "/tmp/.stencila", wasRestored: false },
        results: [{ exitCode: 0 }]
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockCache.saveCache.mockRejectedValue(new Error("Service unavailable"));

      const result = await saveCache(context);

      expect(result).toBe(context);
      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ Failed to save cache: Service unavailable");
    });

    it("should validate context requirements", async () => {
      await expect(saveCache({})).rejects.toThrow(
        "Context must have inputs populated before saving cache"
      );
    });
  });
});