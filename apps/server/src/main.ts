import "reflect-metadata";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter.js";
import { PreviewProxyService } from "./infrastructure/sandbox/services/preview-proxy.service.js";

export async function createApplication({
  production = false,
  logger = true,
} = {}) {
  const transport = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(transport),
    { bodyParser: false, logger: logger ? undefined : false },
  );
  const proxy = app.get(PreviewProxyService);
  // Preview and HMR must retain their original body before Nest parses JSON.
  transport.use((request, response, next) => {
    if (proxy.matches(request.path)) {
      proxy.request(request, response);
      return;
    }
    next();
  });
  transport.use(express.json({ limit: 32 * 1024 }));
  app.useGlobalFilters(new ApiExceptionFilter());
  if (production) {
    const webRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../web/dist",
    );
    transport.use(express.static(webRoot, { index: false }));
    transport.use((request, response, next) => {
      if (
        request.method === "GET" &&
        !request.path.startsWith("/api/") &&
        !request.path.startsWith("/proxy/") &&
        !request.path.startsWith("/absproxy/") &&
        !request.path.startsWith("/published/")
      ) {
        response.sendFile(path.join(webRoot, "index.html"));
        return;
      }
      next();
    });
  }
  app
    .getHttpServer()
    .on(
      "upgrade",
      (
        request: import("node:http").IncomingMessage,
        socket: import("node:stream").Duplex,
        head: Buffer,
      ) => {
        if (
          proxy.matches(
            new URL(request.url || "/", "http://localhost").pathname,
          )
        )
          proxy.upgrade(request, socket, head);
        else socket.destroy();
      },
    );
  app.enableShutdownHooks();
  await app.init();
  return app;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const production = process.argv.includes("--production");
  const app = await createApplication({ production });
  const port = Number(process.env.PORT || (production ? 4173 : 4174));
  await app.listen(port, process.env.HOST || "127.0.0.1");
  console.log(`Artifact NestJS 服务已启动：http://localhost:${port}`);
}
