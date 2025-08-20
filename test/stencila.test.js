// @ts-check

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { createCoreMock, createExecMock, createToolCacheMock } from "./helpers/mock-actions.js";

// Create the mocks at the top level
const coreMock = createCoreMock();
const execMock = createExecMock();
const toolCacheMock = createToolCacheMock();

// Mock all dependencies using vi.mock (hoisted)
vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/exec", () => execMock);
vi.mock("@actions/tool-cache", () => toolCacheMock);

// Mock Node.js built-ins
vi.mock("fs");
vi.mock("https");
vi.mock("crypto");

// Import the module after mocking
const { ensureStencila, resolveVersion, verifyChecksum, fetchChecksumFromGitHub } = await import("../src/stencila.js");

describe("stencila.js", () => {
  /**
   * Helper to set up GitHub API mock
   * @param {boolean} hasChecksum - Whether to include checksum in response
   * @param {string} checksum - The checksum value to return
   */
  function setupGitHubApiMock(hasChecksum = false, checksum = "7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730") {
    const mockReq = {
      on: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn()
    };

    vi.mocked(import("https")).then(https => {
      https.get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          // Mock GitHub API response
          const assetsData = hasChecksum 
            ? `{"assets":[{"name":"cli-v2.0.0-x86_64-unknown-linux-gnu.tar.gz","digest":"sha256:${checksum}"}]}`
            : '{"assets":[]}';
          
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb(assetsData);
              } else if (event === "end") {
                cb();
              }
            })
          });
        } else if (url.includes("releases/latest")) {
          // Mock latest version resolution
          callback({
            statusCode: 302,
            headers: {
              location: "https://github.com/stencila/stencila/releases/tag/v2.1.0"
            }
          });
        }
        return mockReq;
      });
    });
  }

  beforeEach(() => {
    // Reset all mocks for each test
    vi.clearAllMocks();
    coreMock.clearInputValues();

    // Set up default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["cli-v2.0.0-x86_64-unknown-linux-gnu"]);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true });
    vi.mocked(fs.createReadStream).mockReturnValue({
      on: vi.fn((event, callback) => {
        if (event === "data") {
          // Simulate file data for checksum
          callback(Buffer.from("test file content"));
        } else if (event === "end") {
          callback();
        }
        return this;
      })
    });

    // Set up default tool-cache mocks
    toolCacheMock.find.mockReturnValue(""); // Not cached by default
    toolCacheMock.downloadTool.mockResolvedValue("/tmp/download/stencila.tar.gz");
    toolCacheMock.extractTar.mockResolvedValue("/tmp/extracted");
    toolCacheMock.extractZip.mockResolvedValue("/tmp/extracted");
    toolCacheMock.cacheDir.mockResolvedValue("/tmp/cached");

    // Set up default exec mocks
    execMock.exec.mockResolvedValue(0);

    // Set up default crypto mocks
    const mockHash = {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue("7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730")
    };
    vi.mocked(crypto.createHash).mockReturnValue(mockHash);
  });

  describe("resolveVersion", () => {
    it("should resolve latest version from GitHub API", async () => {
      // Mock https.get for latest version resolution
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        // Simulate redirect response
        callback({
          statusCode: 302,
          headers: {
            location: "https://github.com/stencila/stencila/releases/tag/v2.1.5"
          }
        });
        return mockReq;
      });

      const version = await resolveVersion("latest");
      expect(version).toBe("v2.1.5");
      expect(coreMock.info).toHaveBeenCalledWith("Resolving latest version...");
      expect(coreMock.info).toHaveBeenCalledWith("Latest version resolved to: v2.1.5");
    });

    it("should validate and normalize specific version", async () => {
      const version = await resolveVersion("2.0.0");
      expect(version).toBe("v2.0.0");
      expect(coreMock.info).toHaveBeenCalledWith("Using specific version: v2.0.0");
    });

    it("should accept version with v prefix", async () => {
      const version = await resolveVersion("v1.19.0");
      expect(version).toBe("v1.19.0");
    });

    it("should reject invalid version format", async () => {
      await expect(resolveVersion("invalid-version")).rejects.toThrow(
        "Invalid version format: invalid-version"
      );
    });

    it("should handle GitHub API errors", async () => {
      const mockReq = {
        on: vi.fn((event, callback) => {
          if (event === "error") {
            callback(new Error("Network error"));
          }
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation(() => mockReq);

      await expect(resolveVersion("latest")).rejects.toThrow(
        "Failed to resolve latest version: Network error"
      );
    });

    it("should handle non-redirect response", async () => {
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        callback({
          statusCode: 200,
          headers: {}
        });
        return mockReq;
      });

      await expect(resolveVersion("latest")).rejects.toThrow(
        "Expected redirect from latest release URL, got 200"
      );
    });

    it("should handle timeout", async () => {
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn((timeout, callback) => {
          setTimeout(callback, 0); // Immediate timeout for testing
        }),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation(() => mockReq);

      await expect(resolveVersion("latest")).rejects.toThrow(
        "Timeout resolving latest version"
      );
    });
  });

  describe("fetchChecksumFromGitHub", () => {
    it("should fetch checksum from GitHub API", async () => {
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        // Simulate successful API response
        callback({
          statusCode: 200,
          on: vi.fn((event, cb) => {
            if (event === "data") {
              cb('{"assets":[{"name":"cli-v2.0.0-x86_64-unknown-linux-gnu.tar.gz","digest":"sha256:abc123"}]}');
            } else if (event === "end") {
              cb();
            }
          })
        });
        return mockReq;
      });

      const checksum = await fetchChecksumFromGitHub("v2.0.0", "x86_64-unknown-linux-gnu", "tar.gz");
      expect(checksum).toBe("sha256:abc123");
      expect(coreMock.info).toHaveBeenCalledWith("📋 Found checksum for cli-v2.0.0-x86_64-unknown-linux-gnu.tar.gz from GitHub API");
    });

    it("should handle missing asset", async () => {
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        callback({
          statusCode: 200,
          on: vi.fn((event, cb) => {
            if (event === "data") {
              cb('{"assets":[]}');
            } else if (event === "end") {
              cb();
            }
          })
        });
        return mockReq;
      });

      const checksum = await fetchChecksumFromGitHub("v2.0.0", "x86_64-unknown-linux-gnu", "tar.gz");
      expect(checksum).toBeNull();
      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ No checksum found for cli-v2.0.0-x86_64-unknown-linux-gnu.tar.gz in GitHub release v2.0.0");
    });

    it("should handle API errors", async () => {
      const mockReq = {
        on: vi.fn((event, callback) => {
          if (event === "error") {
            callback(new Error("Network error"));
          }
        }),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation(() => mockReq);

      const checksum = await fetchChecksumFromGitHub("v2.0.0", "x86_64-unknown-linux-gnu", "tar.gz");
      expect(checksum).toBeNull();
      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ Failed to fetch checksum from GitHub API: Network error");
    });

    it("should handle non-200 status codes", async () => {
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        callback({
          statusCode: 404,
          on: vi.fn((event, cb) => {
            if (event === "end") {
              cb();
            }
          })
        });
        return mockReq;
      });

      const checksum = await fetchChecksumFromGitHub("v2.0.0", "x86_64-unknown-linux-gnu", "tar.gz");
      expect(checksum).toBeNull();
      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ GitHub API returned 404 for v2.0.0");
    });

    it("should handle timeout", async () => {
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn((timeout, callback) => {
          setTimeout(callback, 0); // Immediate timeout for testing
        }),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation(() => mockReq);

      const checksum = await fetchChecksumFromGitHub("v2.0.0", "x86_64-unknown-linux-gnu", "tar.gz");
      expect(checksum).toBeNull();
      expect(coreMock.warning).toHaveBeenCalledWith("⚠️ Timeout fetching checksum from GitHub API");
    });
  });

  describe("verifyChecksum", () => {
    it("should verify correct checksum", async () => {
      const result = await verifyChecksum("/tmp/file", "sha256:7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730");
      expect(result).toBe(true);
      expect(coreMock.info).toHaveBeenCalledWith("✅ Checksum verified: 7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730");
    });

    it("should handle checksum without sha256 prefix", async () => {
      const result = await verifyChecksum("/tmp/file", "7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730");
      expect(result).toBe(true);
    });

    it("should detect checksum mismatch", async () => {
      const result = await verifyChecksum("/tmp/file", "wrongchecksum");
      expect(result).toBe(false);
      expect(coreMock.error).toHaveBeenCalledWith("❌ Checksum mismatch!");
    });

    it("should handle file read errors", async () => {
      vi.mocked(fs.createReadStream).mockReturnValue({
        on: vi.fn((event, callback) => {
          if (event === "error") {
            callback(new Error("File not found"));
          }
          return this;
        })
      });

      await expect(verifyChecksum("/tmp/file", "checksum")).rejects.toThrow("File not found");
    });
  });

  describe("ensureStencila", () => {
    let context;

    beforeEach(() => {
      context = {
        inputs: {
          version: "v2.0.0"
        },
        env: {
          platform: "linux",
          arch: "x64", 
          platformString: "x86_64-unknown-linux-gnu",
          extension: "tar.gz"
        }
      };
    });

    it("should install Stencila when not cached", async () => {
      // Mock GitHub API response for checksum
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          // Mock GitHub API response with checksum
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[{"name":"cli-v2.0.0-x86_64-unknown-linux-gnu.tar.gz","digest":"sha256:7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730"}]}');
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      const result = await ensureStencila(context);

      expect(result).toBe(context);
      expect(context.stencila).toBeDefined();
      expect(context.stencila.version).toBe("v2.0.0");
      expect(context.stencila.resolvedVersion).toBe("v2.0.0");
      expect(context.stencila.wasAlreadyInstalled).toBe(false);
      expect(context.stencila.checksumVerified).toBe(true);
      expect(context.stencila.binaryPath).toBe("/tmp/cached/stencila");
      expect(context.stencila.installDuration).toBeGreaterThanOrEqual(0);

      // Verify core actions were called
      expect(toolCacheMock.downloadTool).toHaveBeenCalled();
      expect(toolCacheMock.extractTar).toHaveBeenCalled();
      expect(toolCacheMock.cacheDir).toHaveBeenCalled();
      expect(execMock.exec).toHaveBeenCalledWith("chmod", ["+x", "/tmp/extracted/stencila"]);
      expect(coreMock.addPath).toHaveBeenCalled();
      expect(coreMock.setOutput).toHaveBeenCalledWith("version", "");
      expect(coreMock.setOutput).toHaveBeenCalledWith("binary-path", "/tmp/cached/stencila");
    });

    it("should use cached Stencila when available", async () => {
      // Mock that Stencila is already cached
      toolCacheMock.find.mockReturnValue("/tmp/cached");

      const result = await ensureStencila(context);

      expect(result).toBe(context);
      expect(context.stencila.wasAlreadyInstalled).toBe(true);
      expect(context.stencila.binaryPath).toBe("/tmp/cached/stencila");

      // Verify download was skipped
      expect(toolCacheMock.downloadTool).not.toHaveBeenCalled();
      expect(coreMock.info).toHaveBeenCalledWith(expect.stringContaining("✅ Using cached Stencila CLI"));
    });

    it("should handle Windows platform", async () => {
      context.env.platform = "win32";
      context.env.platformString = "x86_64-pc-windows-msvc";
      context.env.extension = "zip";

      // Mock GitHub API to return no checksum for simplicity
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[]}'); // No checksum available
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      await ensureStencila(context);

      expect(context.stencila.binaryPath).toBe("/tmp/cached/stencila.exe");
      expect(toolCacheMock.extractZip).toHaveBeenCalled();
      expect(execMock.exec).not.toHaveBeenCalledWith("chmod", expect.anything());
    });

    it("should handle latest version resolution", async () => {
      context.inputs.version = "latest";

      // Mock https.get for both latest version and GitHub API calls
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("releases/latest")) {
          // Mock latest version resolution
          callback({
            statusCode: 302,
            headers: {
              location: "https://github.com/stencila/stencila/releases/tag/v2.1.0"
            }
          });
        } else if (url.includes("api.github.com")) {
          // Mock GitHub API response - no checksum available for simplicity
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[]}'); // No checksum available
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      await ensureStencila(context);

      expect(context.stencila.version).toBe("latest");
      expect(context.stencila.resolvedVersion).toBe("v2.1.0");
    });

    it("should skip checksum verification when not available", async () => {
      // Mock GitHub API to return no checksum
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[]}'); // No assets with checksum
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      await ensureStencila(context);

      expect(context.stencila.checksumVerified).toBe(false);
      expect(coreMock.warning).toHaveBeenCalledWith(
        "⚠️ No checksum available for v2.0.0 on x86_64-unknown-linux-gnu - skipping verification"
      );
    });

    it("should fail on checksum mismatch", async () => {
      // Mock GitHub API to return a checksum
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[{"name":"cli-v2.0.0-x86_64-unknown-linux-gnu.tar.gz","digest":"sha256:expectedchecksum"}]}');
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      // Mock wrong checksum
      const mockHash = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue("wrongchecksum")
      };
      vi.mocked(crypto.createHash).mockReturnValue(mockHash);

      await expect(ensureStencila(context)).rejects.toThrow(
        "Checksum verification failed"
      );
    });

    it("should retry downloads on failure", async () => {
      // Mock GitHub API to return no checksum to avoid checksum verification
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[]}'); // No checksum available
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      // Mock download failures then success
      toolCacheMock.downloadTool
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue("/tmp/download/stencila.tar.gz");

      await ensureStencila(context);

      expect(toolCacheMock.downloadTool).toHaveBeenCalledTimes(3);
      // Expect 2 download warnings + checksum-related warnings = 4 total warnings
      expect(coreMock.warning).toHaveBeenCalledTimes(4);
      expect(coreMock.info).toHaveBeenCalledWith(expect.stringContaining("Retrying download"));
    });

    it("should fail after max retries", async () => {
      // Mock all download attempts to fail
      toolCacheMock.downloadTool.mockRejectedValue(new Error("Network error"));

      await expect(ensureStencila(context)).rejects.toThrow(
        "Download failed after 3 attempts"
      );

      expect(toolCacheMock.downloadTool).toHaveBeenCalledTimes(3);
    });

    it("should handle missing binary in extracted archive", async () => {
      // Mock GitHub API to return no checksum to avoid checksum verification
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[]}'); // No checksum available
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(ensureStencila(context)).rejects.toThrow(
        "Could not find stencila in extracted archive"
      );
    });

    it("should handle missing cached binary", async () => {
      // Mock cached path exists but binary doesn't
      toolCacheMock.find.mockReturnValue("/tmp/cached");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(ensureStencila(context)).rejects.toThrow(
        "Cached Stencila binary not found"
      );
    });

    it("should validate context has required properties", async () => {
      await expect(ensureStencila({})).rejects.toThrow(
        "Context must have inputs populated"
      );

      await expect(ensureStencila({ inputs: {} })).rejects.toThrow(
        "Context must have env populated"
      );
    });

    it("should handle version verification failure", async () => {
      // Mock GitHub API to return no checksum to avoid checksum verification
      const mockReq = {
        on: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn()
      };

      vi.mocked(await import("https")).get.mockImplementation((url, options, callback) => {
        if (url.includes("api.github.com")) {
          callback({
            statusCode: 200,
            on: vi.fn((event, cb) => {
              if (event === "data") {
                cb('{"assets":[]}'); // No checksum available
              } else if (event === "end") {
                cb();
              }
            })
          });
        }
        return mockReq;
      });

      // Mock chmod to succeed, then version check to fail
      execMock.exec
        .mockResolvedValueOnce(0) // chmod succeeds
        .mockRejectedValueOnce(new Error("Binary not found")); // version check fails

      await expect(ensureStencila(context)).rejects.toThrow(
        "Failed to verify Stencila installation: Binary not found"
      );
    });
  });
});