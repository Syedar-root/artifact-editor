import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Request, Response } from "express";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import httpProxy from "http-proxy";
import { ServerConfigService } from "../../../config/server-config.service.js";

/** 应用只负责同源入口；端口路由和沙箱内转发交给 AIO 官方代理。 */
@Injectable()
export class PreviewProxyService implements OnModuleDestroy {
  private readonly proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    ws: true,
  });
  private readonly pattern = /^\/(?:absproxy|proxy)\/(5\d{3})\//u;

  constructor(
    @Inject(ServerConfigService) private readonly config: ServerConfigService,
  ) {}

  request(request: Request, response: Response) {
    this.proxy.web(request, response, this.options(request), (error) => {
      if (response.headersSent) response.destroy(error);
      else
        response
          .status(502)
          .json({ error: `无法连接沙箱预览：${error.message}` });
    });
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    this.proxy.ws(request, socket, head, this.options(request), () =>
      socket.destroy(),
    );
  }

  matches(url: string) {
    return this.pattern.test(url);
  }
  onModuleDestroy() {
    this.proxy.close();
  }

  private options(request: IncomingMessage): httpProxy.ServerOptions {
    const port = this.pattern.exec(request.url ?? "")?.[1];
    if (!port) throw new Error("无效的预览路径");
    request.url = request.url?.replace(/^\/proxy\//u, "/absproxy/");
    return {
      target: this.config.sandboxBaseUrl,
      headers: {
        // 覆盖客户端的控制头，端口只能由受控预览路径决定。
        "x-aio-proxy-port": port,
        ...(this.config.sandboxToken
          ? { Authorization: `Bearer ${this.config.sandboxToken}` }
          : {}),
      },
    };
  }
}
