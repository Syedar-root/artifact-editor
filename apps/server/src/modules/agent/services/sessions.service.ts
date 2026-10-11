import { Inject, Injectable } from "@nestjs/common";
import { DshRuntimeService } from "./dsh-runtime.service.js";
import { ArtifactsService } from "../../artifacts/services/artifacts.service.js";
import { SessionViewService } from "./session-view.service.js";

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DshRuntimeService) private readonly runtime: DshRuntimeService,
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(SessionViewService) private readonly view: SessionViewService,
  ) {}

  async read(sessionId: string, artifactId: string) {
    const ctx = await this.runtime.context();
    const result = await this.view.read(
      ctx.sessionPersistence,
      sessionId,
      this.artifacts.workspace(artifactId).root,
    );
    if (result.session) result.session.artifactId = artifactId;
    if (result.sessions)
      result.sessions = result.sessions.map((session) => ({
        ...session,
        artifactId,
      }));
    return result;
  }
}
