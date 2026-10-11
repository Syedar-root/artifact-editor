import { Inject, Injectable } from "@nestjs/common";
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
}
