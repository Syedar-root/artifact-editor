import path from "node:path";
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { BuildService } from "../services/build.service.js";

/** 从持久化目录提供构建结果；这里不访问沙箱。 */
@Controller("published")
export class PublishedController {
  constructor(@Inject(BuildService) private readonly builds: BuildService) {}

  @Get([":artifactId/:commitSha", ":artifactId/:commitSha/{*asset}"])
  async file(@Req() request: Request, @Res() response: Response) {
    const artifactId = String(request.params.artifactId);
    const commitSha = String(request.params.commitSha);
    const record = await this.builds.status(artifactId, commitSha);
    if (record?.status !== "ready")
      throw new NotFoundException("此版本还没有可访问的构建结果");
    const asset = request.params.asset;
    const relative = path.posix.normalize(
      (Array.isArray(asset) ? asset.join("/") : asset) || "index.html",
    );
    if (
      relative.startsWith("../") ||
      relative === ".." ||
      relative.includes("\\") ||
      relative.includes("\0") ||
      path.posix.isAbsolute(relative)
    )
      throw new NotFoundException("文件路径无效");
    await new Promise<void>((resolve, reject) =>
      response.sendFile(
        relative,
        {
          root: path.join(
            this.builds.directory(artifactId, commitSha),
            "files",
          ),
          dotfiles: "deny",
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        },
        (error) =>
          error ? reject(new NotFoundException("找不到构建文件")) : resolve(),
      ),
    );
  }
}
