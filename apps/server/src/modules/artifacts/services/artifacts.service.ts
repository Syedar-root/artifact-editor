import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PreviewService } from "./preview.service.js";
import { WorkspaceService } from "./workspace.service.js";
import { ArtifactRepository } from "../repositories/artifact.repository.js";
import { ArtifactModel } from "../models/artifact.model.js";

@Injectable()
export class ArtifactsService {
  constructor(
    @Inject(ArtifactRepository) private readonly repository: ArtifactRepository,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(PreviewService) private readonly previews: PreviewService,
  ) {}

  list = () => this.repository.list();
  start = (id: string, onProgress?: (phase: string) => void) =>
    this.previews.start(id, onProgress);
  get = (id: string, options?: { signal?: AbortSignal }) =>
    this.repository.get(id, options);
  workspace = (id: string) => this.workspaces.forArtifact(id);
  initialize = (id: string) => this.workspaces.initialize(id);

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
    const snapshot =
      action === "resume"
        ? await workspace.versions.resume()
        : await workspace.versions[action](version!);
    return { ...snapshot, artifact: await this.start(id) };
  }
}
