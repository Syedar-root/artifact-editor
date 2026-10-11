import { Inject, Injectable } from "@nestjs/common";
import path from "node:path";
import {
  requireSuccess,
  shellCommand,
  type FileEntry,
} from "@artifact-editor/sdk/server";
import { ServerConfigService } from "../../../config/server-config.service.js";
import { SandboxCommandService } from "../../../infrastructure/sandbox/services/sandbox-command.service.js";
import { ArtifactFilesystemService } from "./artifact-filesystem.service.js";
import { DependenciesService } from "./dependencies.service.js";
import { ArtifactModel } from "../models/artifact.model.js";
import { ArtifactWorkspace } from "../models/artifact-workspace.model.js";

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(SandboxCommandService)
    private readonly commands: SandboxCommandService,
    @Inject(ArtifactFilesystemService)
    private readonly filesystem: ArtifactFilesystemService,
    @Inject(DependenciesService)
    private readonly dependencies: DependenciesService,
    @Inject(ServerConfigService) private readonly config: ServerConfigService,
  ) {}

  root(artifactId: string) {
    if (!ArtifactModel.isValidId(artifactId))
      throw new Error("无效的 artifact ID");
    return `${this.config.workspaceRoot}/${artifactId}`;
  }

  forArtifact(artifactId: string) {
    return new ArtifactWorkspace({
      files: this.filesystem,
      execute: (command, options) => this.commands.run(command, options),
      root: this.root(artifactId),
      buildCommand: "npm run build",
      prepareDependencies: (current, options) =>
        this.dependencies.ensure(current.root, options),
    });
  }

  initialize(artifactId: string) {
    return this.forArtifact(artifactId).versions.initialize({
      message: "Create artifact",
      ignore: ["node_modules", "dist/", ".vite/", ".artifact/"],
    });
  }

  async ensureReady(artifactId: string, signal?: AbortSignal) {
    const workspace = this.forArtifact(artifactId);
    requireSuccess(
      await workspace.execute(
        "test -d . && test -r . && test -w . && node --version",
        { signal },
      ),
    );
    await workspace.prepareDependencies({
      mode: "restore",
      persistLock: false,
      signal,
    });
    return workspace;
  }

  async checkpoint(artifactId: string, version: number) {
    const checkpoint = (
      await this.forArtifact(artifactId).versions.list()
    ).find((item) => item.version === version);
    if (!checkpoint) throw new Error(`找不到 V${version}`);
    return checkpoint;
  }

  async snapshotFiles(artifactId: string, version: number) {
    const checkpoint = await this.checkpoint(artifactId, version);
    const result = requireSuccess(
      await this.forArtifact(artifactId).execute(
        shellCommand([
          "git",
          "ls-tree",
          "-rz",
          "--name-only",
          checkpoint.commitSha,
        ]),
        { maxOutputBytes: 1024 * 1024 },
      ),
    );
    const tree: FileEntry[] = [];
    const directories = new Map<string, FileEntry[]>([[".", tree]]);
    for (const file of result.stdout.split("\0").filter(Boolean).sort()) {
      const parts = file.split("/");
      for (let depth = 1; depth < parts.length; depth++) {
        const directory = parts.slice(0, depth).join("/");
        if (directories.has(directory)) continue;
        const children: FileEntry[] = [];
        directories
          .get(path.posix.dirname(directory))!
          .push({
            name: parts[depth - 1],
            path: directory,
            type: "directory",
            children,
          });
        directories.set(directory, children);
      }
      directories
        .get(path.posix.dirname(file))!
        .push({ name: path.posix.basename(file), path: file, type: "file" });
    }
    return {
      root: this.root(artifactId),
      tree,
      truncated: false,
      defaultFile: result.stdout.split("\0").includes("index.html")
        ? "index.html"
        : result.stdout.split("\0")[0] || "",
    };
  }

  async snapshotFile(artifactId: string, version: number, file: string) {
    const normalized = ArtifactWorkspace.resultPath(
      this.root(artifactId),
      file,
    );
    if (normalized === "." || file.includes("\\") || file.includes("\0"))
      throw new Error("文件路径无效");
    const checkpoint = await this.checkpoint(artifactId, version);
    const result = requireSuccess(
      await this.forArtifact(artifactId).execute(
        shellCommand(["git", "show", `${checkpoint.commitSha}:${normalized}`]),
        { maxOutputBytes: 1024 * 1024 },
      ),
    );
    if (result.stdout.includes("\0"))
      throw new Error("这是二进制文件，暂不支持文本读取");
    return {
      path: normalized,
      content: result.stdout,
      size: Buffer.byteLength(result.stdout),
    };
  }
}
