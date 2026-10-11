import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { SandboxClient, type SandboxApi } from "@agent-infra/sandbox";
import { requireSuccess, shellCommand } from "@artifact-editor/sdk/server";
import { ServerConfigService } from "../../../config/server-config.service.js";
import { SandboxCommandService } from "../../../infrastructure/sandbox/services/sandbox-command.service.js";
import { SandboxResponse } from "../../../infrastructure/sandbox/models/sandbox-response.model.js";
import { WorkspaceService } from "./workspace.service.js";
import { DependenciesService } from "./dependencies.service.js";
import { ArtifactModel } from "../models/artifact.model.js";
import { ArtifactWorkspace } from "../models/artifact-workspace.model.js";
import type {
  ArtifactBuild,
  BuildCheckpoint,
} from "../models/artifact-build.model.js";

/** 固定 Git commit 构建，并将完整静态资源持久化到 Server 可访问的 NAS。 */
@Injectable()
export class BuildService implements OnModuleDestroy {
  private readonly jobs = new Map<string, Promise<ArtifactBuild>>();
  private readonly stopping = new AbortController();
  private readonly logger = new Logger(BuildService.name);

  constructor(
    @Inject(SandboxClient) private readonly client: SandboxClient,
    @Inject(SandboxCommandService)
    private readonly commands: SandboxCommandService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(DependenciesService)
    private readonly dependencies: DependenciesService,
    @Inject(ServerConfigService) private readonly config: ServerConfigService,
  ) {}

  schedule(artifactId: string, checkpoint: BuildCheckpoint): ArtifactBuild {
    this.validate(artifactId, checkpoint.commitSha);
    const now = new Date().toISOString();
    const queued: ArtifactBuild = {
      ...checkpoint,
      artifactId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    void this.ensure(artifactId, checkpoint).catch((error) =>
      this.logger.warn(
        `V${checkpoint.version} 构建失败：${error instanceof Error ? error.message : error}`,
      ),
    );
    return queued;
  }

  ensure(
    artifactId: string,
    checkpoint: BuildCheckpoint,
  ): Promise<ArtifactBuild> {
    this.validate(artifactId, checkpoint.commitSha);
    const key = `${artifactId}/${checkpoint.commitSha}`;
    const running = this.jobs.get(key);
    if (running) return running;
    const job = this.build(artifactId, checkpoint).finally(() =>
      this.jobs.delete(key),
    );
    this.jobs.set(key, job);
    return job;
  }

  async list(artifactId: string): Promise<ArtifactBuild[]> {
    if (!ArtifactModel.isValidId(artifactId))
      throw new Error("无效的 artifact ID");
    let entries;
    try {
      entries = await fs.readdir(
        path.join(this.config.releaseRoot, artifactId),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(
      entries
        .filter((entry) => /^[0-9a-f]{40,64}$/u.test(entry))
        .map((sha) => this.status(artifactId, sha)),
    );
    return records
      .filter((record): record is ArtifactBuild => record !== null)
      .sort((a, b) => b.version - a.version);
  }

  async status(
    artifactId: string,
    commitSha: string,
  ): Promise<ArtifactBuild | null> {
    const directory = this.directory(artifactId, commitSha);
    let record: ArtifactBuild;
    try {
      record = JSON.parse(
        await fs.readFile(path.join(directory, "build.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (record.artifactId !== artifactId || record.commitSha !== commitSha)
      throw new Error("构建记录与版本不匹配");
    if (record.status === "ready") {
      try {
        await fs.access(path.join(directory, "files", "index.html"));
      } catch {
        return {
          ...record,
          status: "failed",
          previewUrl: undefined,
          error: "构建文件缺失，请重新构建",
        };
      }
    } else if (
      (record.status === "building" || record.status === "queued") &&
      !this.jobs.has(`${artifactId}/${commitSha}`)
    ) {
      return {
        ...record,
        status: "failed",
        error: "上次构建已中断，可以重新构建",
      };
    }
    return record;
  }

  directory(artifactId: string, commitSha: string) {
    this.validate(artifactId, commitSha);
    const root = path.resolve(this.config.releaseRoot);
    const directory = path.resolve(root, artifactId, commitSha);
    if (!directory.startsWith(root + path.sep))
      throw new Error("构建目录超出持久化路径");
    return directory;
  }

  async onModuleDestroy() {
    this.stopping.abort(new Error("Server 正在停止，构建已中断"));
    await Promise.allSettled(this.jobs.values());
  }

  private validate(artifactId: string, commitSha: string) {
    if (
      !ArtifactModel.isValidId(artifactId) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commitSha)
    )
      throw new Error("产物或提交版本无效");
  }

  private async save(record: ArtifactBuild) {
    const directory = this.directory(record.artifactId, record.commitSha);
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.build-${randomUUID()}.json`);
    try {
      await fs.writeFile(temporary, JSON.stringify(record, null, 2));
      await fs.rename(temporary, path.join(directory, "build.json"));
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  private async build(
    artifactId: string,
    checkpoint: BuildCheckpoint,
  ): Promise<ArtifactBuild> {
    const existing = await this.status(artifactId, checkpoint.commitSha);
    if (existing?.status === "ready") return existing;
    const now = new Date().toISOString();
    let record: ArtifactBuild = {
      ...checkpoint,
      artifactId,
      status: "building",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.save(record);
    const signal = this.stopping.signal;
    const fastRoot = this.config.buildRoot;
    let stage: string | undefined;
    let localStage: string | undefined;
    try {
      signal.throwIfAborted();
      requireSuccess(
        await this.commands.run(shellCommand(["mkdir", "-p", "--", fastRoot]), {
          signal,
        }),
      );
      stage = requireSuccess(
        await this.commands.run(
          shellCommand(["mktemp", "-d", "--", `${fastRoot}/build-XXXXXX`]),
          { signal },
        ),
      ).stdout.trim();
      if (
        path.posix.dirname(stage) !== fastRoot ||
        !path.posix.basename(stage).startsWith("build-")
      )
        throw new Error("沙箱返回了无效的构建目录");
      // 导出固定提交，构建不改变编辑目录，也不读取下一轮修改。
      await this.workspaces
        .forArtifact(artifactId)
        .execute(
          shellCommand([
            "bash",
            "-o",
            "pipefail",
            "-c",
            shellCommand([
              "git",
              "archive",
              "--format=tar",
              checkpoint.commitSha,
            ]) +
              " | " +
              shellCommand(["tar", "-x", "-C", stage]),
          ]),
          { signal },
        )
        .then(requireSuccess);
      await this.dependencies.ensure(stage, {
        mode: "restore",
        persistLock: false,
        signal,
      });
      const previewUrl = `/published/${artifactId}/${checkpoint.commitSha}/`;
      const output = path.posix.join(stage, "dist");
      record.runtime = requireSuccess(
        await this.commands.run("node --version && uname -sm", {
          cwd: stage,
          signal,
        }),
      ).stdout.trim();
      requireSuccess(
        await this.commands.run(
          shellCommand([
            "npm",
            "run",
            "build",
            "--",
            `--base=${previewUrl}`,
            `--outDir=${output}`,
          ]),
          { cwd: stage, signal, timeoutMs: 300_000 },
        ),
      );
      const symlinks = requireSuccess(
        await this.commands.run(
          shellCommand(["find", output, "-type", "l", "-print", "-quit"]),
          { signal },
        ),
      ).stdout;
      if (symlinks) throw new Error("构建结果不能包含外部文件链接");
      await fs.mkdir(this.config.releaseRoot, { recursive: true });
      localStage = await fs.mkdtemp(
        path.join(this.config.releaseRoot, ".build-"),
      );
      await this.download(output, localStage, signal);
      await fs.access(path.join(localStage, "index.html"));
      const published = path.join(
        this.directory(artifactId, checkpoint.commitSha),
        "files",
      );
      // 仅完整下载的目录对外可见。旧的成功版本目录不会被失败构建修改。
      await fs.rm(published, { recursive: true, force: true });
      await fs.rename(localStage, published);
      localStage = undefined;
      record = {
        ...record,
        status: "ready",
        previewUrl,
        updatedAt: new Date().toISOString(),
      };
      await this.save(record);
      return record;
    } catch (error) {
      record = {
        ...record,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "构建失败",
      };
      await this.save(record);
      throw error;
    } finally {
      if (
        stage &&
        path.posix.dirname(stage) === fastRoot &&
        path.posix.basename(stage).startsWith("build-")
      ) {
        await this.commands
          .run(shellCommand(["rm", "-rf", "--", stage]), { timeoutMs: 30_000 })
          .then(requireSuccess)
          .catch((error) =>
            this.logger.warn(
              `临时构建目录清理失败：${error instanceof Error ? error.message : error}`,
            ),
          );
      }
      if (localStage) await fs.rm(localStage, { recursive: true, force: true });
    }
  }

  private async download(
    output: string,
    destination: string,
    signal: AbortSignal,
  ) {
    const listing = SandboxResponse.data<SandboxApi.FileGlobResult>(
      await this.client.file.globFiles(
        {
          path: output,
          pattern: "**/*",
          files_only: true,
          include_hidden: true,
          include_metadata: true,
          max_results: 10_001,
        },
        { abortSignal: signal },
      ),
    );
    const files = listing.files ?? [];
    if (listing.truncated || files.length > 10_000)
      throw new Error("构建文件数量超过限制");
    let total = 0;
    for (const entry of files) {
      const relative = ArtifactWorkspace.resultPath(output, entry.path);
      if (relative === "." || relative.includes("\\"))
        throw new Error("构建文件路径无效");
      const target = path.join(destination, ...relative.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      const response = await this.client.file.downloadFile(
        { path: path.posix.join(output, relative) },
        { abortSignal: signal, timeoutInSeconds: 60 },
      );
      if (!response.ok) throw new Error(`无法下载构建文件：${relative}`);
      let size = 0;
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          total += chunk.length;
          callback(
            size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024
              ? new Error("构建资源大小超过限制")
              : null,
            chunk,
          );
        },
      });
      await pipeline(
        Readable.fromWeb(
          response.body.stream() as import("node:stream/web").ReadableStream<Uint8Array>,
        ),
        limit,
        createWriteStream(target, { flags: "wx" }),
        { signal },
      );
    }
  }
}
