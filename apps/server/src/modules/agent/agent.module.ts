import { Module } from "@nestjs/common";
import { DshRuntimeService } from "./services/dsh-runtime.service.js";
import { ArtifactsModule } from "../artifacts/artifacts.module.js";
import { ChatController } from "./controllers/chat.controller.js";
import { ChatService } from "./services/chat.service.js";
import { SessionsController } from "./controllers/sessions.controller.js";
import { SessionsService } from "./services/sessions.service.js";
import { AgentToolsService } from "./services/agent-tools.service.js";
import { SessionViewService } from "./services/session-view.service.js";
import { ServerConfigService } from "../../config/server-config.service.js";

@Module({
  imports: [ArtifactsModule],
  controllers: [ChatController, SessionsController],
  providers: [
    ChatService,
    SessionsService,
    AgentToolsService,
    SessionViewService,
    {
      provide: DshRuntimeService,
      inject: [ServerConfigService],
      useFactory: (config: ServerConfigService) =>
        new DshRuntimeService({
          sessionRoot: config.sessionRoot,
          model: () => config.agentModel(),
        }),
    },
  ],
})
export class AgentModule {}
