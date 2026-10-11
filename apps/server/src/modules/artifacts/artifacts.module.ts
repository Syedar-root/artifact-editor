import { Module } from "@nestjs/common";
import { ArtifactsController } from "./controllers/artifacts.controller.js";
import { ArtifactsService } from "./services/artifacts.service.js";
import { ArtifactRepository } from "./repositories/artifact.repository.js";
import { PreviewService } from "./services/preview.service.js";
import { WorkspaceService } from "./services/workspace.service.js";
import { ArtifactFilesystemService } from "./services/artifact-filesystem.service.js";
import { SandboxModule } from "../../infrastructure/sandbox/sandbox.module.js";
import { DependenciesService } from "./services/dependencies.service.js";
import { ArtifactTemplateService } from "./services/artifact-template.service.js";
import { BuildService } from "./services/build.service.js";
import { PublishedController } from "./controllers/published.controller.js";

@Module({
  imports: [SandboxModule],
  controllers: [ArtifactsController, PublishedController],
  providers: [
    ArtifactsService,
    ArtifactRepository,
    WorkspaceService,
    PreviewService,
    ArtifactFilesystemService,
    DependenciesService,
    ArtifactTemplateService,
    BuildService,
  ],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
