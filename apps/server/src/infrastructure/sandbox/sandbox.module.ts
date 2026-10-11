import { Module } from "@nestjs/common";
import { SandboxClient } from "@agent-infra/sandbox";
import { ServerConfigService } from "../../config/server-config.service.js";
import { SandboxCommandService } from "./services/sandbox-command.service.js";
import { PreviewProxyService } from "./services/preview-proxy.service.js";

@Module({
  providers: [
    {
      provide: SandboxClient,
      inject: [ServerConfigService],
      useFactory: (config: ServerConfigService) =>
        new SandboxClient({
          environment: config.sandboxBaseUrl,
          baseUrl: config.sandboxBaseUrl,
          // 重试写入或 exec 可能重复产生副作用。
          maxRetries: 0,
          timeoutInSeconds: 40,
          headers: config.sandboxToken
            ? { Authorization: `Bearer ${config.sandboxToken}` }
            : undefined,
        }),
    },
    SandboxCommandService,
    PreviewProxyService,
  ],
  exports: [SandboxClient, SandboxCommandService, PreviewProxyService],
})
export class SandboxModule {}
