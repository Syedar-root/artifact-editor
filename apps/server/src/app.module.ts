import { Module } from "@nestjs/common";
import { ArtifactsModule } from "./modules/artifacts/artifacts.module.js";
import { AgentModule } from "./modules/agent/agent.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ConfigModule } from "./config/config.module.js";

@Module({
  imports: [ConfigModule, ArtifactsModule, AgentModule, HealthModule],
})
export class AppModule {}
