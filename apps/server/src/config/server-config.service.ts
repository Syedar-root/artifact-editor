import path from "node:path";
import { fileURLToPath } from "node:url";
import { Injectable } from "@nestjs/common";
import { config } from "dotenv";

@Injectable()
export class ServerConfigService {
  readonly repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  readonly sandboxBaseUrl: string;
  readonly sandboxToken: string | undefined;
  readonly workspaceRoot: string;
  readonly dependencyRoot: string;
  readonly packageManager: "npm" | "pnpm";
  readonly sessionRoot: string;
  readonly releaseRoot: string;
  readonly buildRoot: string;

  constructor() {
    config({
      path: [
        path.join(this.repositoryRoot, "apps/server/.env"),
        path.join(this.repositoryRoot, ".env"),
      ],
      quiet: true,
    });
    const sandboxUrl = new URL(
      process.env.ARTIFACT_SANDBOX_URL || "http://127.0.0.1:18080",
    );
    if (
      !["http:", "https:"].includes(sandboxUrl.protocol) ||
      sandboxUrl.username ||
      sandboxUrl.password ||
      sandboxUrl.search ||
      sandboxUrl.hash ||
      sandboxUrl.pathname !== "/"
    )
      throw new Error("ARTIFACT_SANDBOX_URL 必须是沙箱 HTTP(S) 服务的根地址");
    this.sandboxBaseUrl = sandboxUrl.origin;
    this.sandboxToken = process.env.ARTIFACT_SANDBOX_TOKEN || undefined;
    this.workspaceRoot = this.sandboxPath(
      process.env.ARTIFACT_WORKSPACE_ROOT,
      "/workspace",
    );
    this.dependencyRoot = this.sandboxPath(
      process.env.ARTIFACT_DEPENDENCY_ROOT,
      "/opt/artifact-dependencies",
    );
    const manager = process.env.ARTIFACT_PACKAGE_MANAGER || "npm";
    if (manager !== "npm" && manager !== "pnpm")
      throw new Error("ARTIFACT_PACKAGE_MANAGER 仅支持 npm 或 pnpm");
    this.packageManager = manager;
    this.sessionRoot = path.resolve(
      this.repositoryRoot,
      process.env.ARTIFACT_SESSION_ROOT || ".artifact-server/sessions",
    );
    this.releaseRoot = path.resolve(
      this.repositoryRoot,
      process.env.ARTIFACT_RELEASE_ROOT || "mock-nas/releases",
    );
    this.buildRoot = this.sandboxPath(
      process.env.ARTIFACT_BUILD_ROOT,
      "/tmp/artifact-builds",
    );
    for (const other of [this.workspaceRoot, this.dependencyRoot]) {
      const relative = path.posix.relative(other, this.buildRoot);
      const inverse = path.posix.relative(this.buildRoot, other);
      if (
        (!relative.startsWith("../") && relative !== "..") ||
        (!inverse.startsWith("../") && inverse !== "..")
      )
        throw new Error("ARTIFACT_BUILD_ROOT 必须与源码、依赖目录分离");
    }
    const relative = path.posix.relative(
      this.workspaceRoot,
      this.dependencyRoot,
    );
    const inverse = path.posix.relative(
      this.dependencyRoot,
      this.workspaceRoot,
    );
    if (
      !relative ||
      !inverse ||
      (!inverse.startsWith("../") &&
        inverse !== ".." &&
        !path.posix.isAbsolute(inverse)) ||
      (!relative.startsWith("../") &&
        relative !== ".." &&
        !path.posix.isAbsolute(relative))
    ) {
      throw new Error(
        "ARTIFACT_DEPENDENCY_ROOT 必须位于 ARTIFACT_WORKSPACE_ROOT 之外",
      );
    }
  }

  agentModel() {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.API_KEY;
    const baseURL =
      process.env.DEEPSEEK_BASE_URL ||
      process.env.BASE_URL ||
      "https://api.deepseek.com";
    const model =
      process.env.DEEPSEEK_MODEL || process.env.MODEL || "deepseek-chat";
    if (!apiKey)
      throw new Error("请在 Server 环境中配置 DEEPSEEK_API_KEY（或 API_KEY）");
    if (!["http:", "https:"].includes(new URL(baseURL).protocol))
      throw new Error("Agent BASE_URL 必须是 HTTP(S) 地址");
    return { apiKey, baseURL, model };
  }

  private sandboxPath(value: string | undefined, fallback: string) {
    const resolved = value || fallback;
    if (
      !path.posix.isAbsolute(resolved) ||
      resolved.includes("\\") ||
      resolved.includes("\0")
    ) {
      throw new Error("沙箱存储路径必须是绝对 POSIX 路径");
    }
    return path.posix.normalize(resolved).replace(/\/$/u, "") || "/";
  }
}
