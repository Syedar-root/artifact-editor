import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PreviewService } from "./preview.service.js";
import { WorkspaceService } from "./workspace.service.js";
import { ArtifactRepository } from "../repositories/artifact.repository.js";
import { ArtifactModel } from "../models/artifact.model.js";
import { BuildService } from "./build.service.js";
import type { BuildCheckpoint } from "../models/artifact-build.model.js";

@Injectable()
export class ArtifactsService {
  constructor(
    @Inject(ArtifactRepository) private readonly repository: ArtifactRepository,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(PreviewService) private readonly previews: PreviewService,
    @Inject(BuildService) private readonly builds: BuildService,
  ) {}

  list = () => this.repository.list();
  start = (id: string, onProgress?: (phase: string) => void) =>
    this.previews.start(id, onProgress);
  get = (id: string, options?: { signal?: AbortSignal }) =>
    this.repository.get(id, options);
  workspace = (id: string) => this.workspaces.forArtifact(id);
  initialize = (id: string) => this.workspaces.initialize(id);
  ensureReady = (id: string, signal?: AbortSignal) =>
    this.workspaces.ensureReady(id, signal);
  scheduleBuild = (id: string, checkpoint: BuildCheckpoint) =>
    this.builds.schedule(id, checkpoint);
  buildRecords = (id: string) => this.builds.list(id);
  snapshotFiles = (id: string, version: number) =>
    this.workspaces.snapshotFiles(id, version);
  snapshotFile = (id: string, version: number, file: string) =>
    this.workspaces.snapshotFile(id, version, file);

  async create(
    name: unknown,
    technologyStack = "html",
    onProgress?: (phase: string) => void,
  ) {
    onProgress?.("workspace");
    const id = await this.repository.create(name, technologyStack);
    onProgress?.("dependencies");
    await this.workspace(id).prepareDependencies();
    await this.initialize(id);
    const checkpoint = (await this.workspace(id).versions.list())[0];
    if (checkpoint) this.scheduleBuild(id, checkpoint);
    return this.get(id);
  }

  async exists(id: string) {
    return ArtifactModel.isValidId(id) && !!(await this.get(id));
  }

  async require(id: string) {
    const artifact = await this.get(id);
    if (!artifact) throw new NotFoundException("找不到这个产物");
    return artifact;
  }

  async transition(
    id: string,
    action: "checkout" | "beginEdit" | "resume",
    version?: number,
  ) {
    await this.require(id);
    await this.initialize(id);
    const workspace = this.workspace(id);
    if (action !== "resume" && version === undefined)
      throw new TypeError("版本号无效");
    if (action === "checkout") {
      const build = await this.build(id, version!);
      const snapshot = await workspace.versions.inspect();
      return {
        ...snapshot,
        state: {
          ...snapshot.state,
          mode: "historical-preview" as const,
          activeVersion: version!,
        },
        artifact: {
          ...(await this.require(id)),
          previewUrl: build.previewUrl!,
          locatorMode: "runtime-hint" as const,
        },
        build,
      };
    }
    const snapshot =
      action === "resume"
        ? await workspace.versions.resume()
        : await workspace.versions[action](version!);
    return { ...snapshot, artifact: await this.start(id) };
  }

  async checkpoints(id: string) {
    await this.require(id);
    await this.initialize(id);
    const snapshot = await this.workspace(id).versions.inspect();
    const records = await this.builds.list(id);
    return {
      ...snapshot,
      checkpoints: snapshot.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        build: records.find(
          (record) => record.commitSha === checkpoint.commitSha,
        ),
      })),
    };
  }

  async build(id: string, version: number) {
    const existing = (await this.builds.list(id)).find(
      (record) => record.version === version,
    );
    if (existing?.status === "ready") return existing;
    return this.builds.ensure(
      id,
      await this.workspaces.checkpoint(id, version),
    );
  }

  async share(id: string, version?: number) {
    if (!ArtifactModel.isValidId(id)) throw new Error("无效的 artifact ID");
    if (version === undefined) {
      const { state } = await this.workspace(id).versions.inspect();
      version = state.workspaceVersion ?? undefined;
    }
    if (version === undefined) throw new Error("请先保存产物版本");
    const build = await this.build(id, version);
    return { build, url: build.previewUrl! };
  }
}
