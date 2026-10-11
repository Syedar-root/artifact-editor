import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ServerConfigService } from "../../../config/server-config.service.js";
import { ArtifactFilesystemService } from "../services/artifact-filesystem.service.js";
import {
  ArtifactModel,
  type Artifact,
  type ArtifactMetadata,
  type TechnologyStack,
} from "../models/artifact.model.js";

@Injectable()
export class ArtifactRepository {
  private readonly previewPort = 5173;
  private readonly stacks = new Set<string>(["html", "react", "vue"]);

  constructor(
    @Inject(ArtifactFilesystemService)
    private readonly filesystem: ArtifactFilesystemService,
    @Inject(ServerConfigService) private readonly config: ServerConfigService,
  ) {}

  async list(options: { signal?: AbortSignal } = {}): Promise<Artifact[]> {
    const metadata = await this.filesystem.discover(
      this.config.workspaceRoot,
      this.previewPort,
      options,
    );
    return metadata.map((item) => this.toArtifact(item));
  }

  async get(id: string, options: { signal?: AbortSignal } = {}) {
    if (!ArtifactModel.isValidId(id)) return null;
    const metadata = await this.filesystem.describe(
      this.config.workspaceRoot,
      id,
      this.previewPort,
      options,
    );
    return metadata ? this.toArtifact(metadata) : null;
  }

  async create(name: unknown, technologyStack = "html") {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed || trimmed.length > 80)
      throw new Error("产物名称应为 1–80 个字符");
    if (!this.stacks.has(technologyStack))
      throw new Error("请选择有效的技术栈");
    const ids = new Set((await this.list()).map((artifact) => artifact.id));
    const base = this.slugify(trimmed);
    let id = base;
    while (ids.has(id))
      id = `${base.slice(0, 42)}-${randomBytes(2).toString("hex")}`;
    await this.filesystem.create(
      this.config.workspaceRoot,
      id,
      trimmed,
      this.previewPort,
      technologyStack as TechnologyStack,
    );
    return id;
  }

  private slugify(value: string) {
    const slug = value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48);
    return slug || `artifact-${randomBytes(3).toString("hex")}`;
  }

  private toArtifact(metadata: ArtifactMetadata): Artifact {
    const requestedStack = this.stacks.has(metadata.requestedStack)
      ? metadata.requestedStack
      : "html";
    const detectedStack = this.stacks.has(metadata.detectedStack)
      ? metadata.detectedStack
      : requestedStack;
    return {
      id: metadata.id,
      name: metadata.name,
      status: "ready",
      previewUrl: `/absproxy/${metadata.previewPort}/`,
      createdAt: metadata.createdAt,
      updatedAt: metadata.createdAt,
      requestedStack,
      detectedStack,
      stackChanged: requestedStack !== detectedStack,
      locatorMode:
        metadata.locatorMode === "code-inspector"
          ? "code-inspector"
          : "runtime-hint",
    };
  }
}
