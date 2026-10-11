import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  Inject,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ArtifactsService } from "../services/artifacts.service.js";
import { ArtifactModel } from "../models/artifact.model.js";

@Controller("api")
export class ArtifactsController {
  constructor(
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
  ) {}

  @Get("artifacts")
  async list(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    response.json({ artifacts: await this.artifacts.list() });
  }

  @Post("artifacts")
  @HttpCode(200)
  async create(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    if (this.wantsArtifactProgress(request)) {
      this.beginArtifactProgress(response);
      try {
        const artifact = await this.artifacts.create(
          request.body?.name,
          request.body?.technologyStack,
          (phase) =>
            this.writeArtifactProgress(response, { type: "progress", phase }),
        );
        this.writeArtifactProgress(response, { type: "complete", artifact });
      } catch (error) {
        this.writeArtifactProgress(response, {
          type: "error",
          error: error instanceof Error ? error.message : "无法创建产物",
        });
      } finally {
        response.end();
      }
      return;
    }
    try {
      const artifact = await this.artifacts.create(
        request.body?.name,
        request.body?.technologyStack,
      );
      response.status(201).json({ artifact });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "无法创建产物",
      });
    }
  }

  @Post("artifacts/:artifactId/start")
  @HttpCode(200)
  async start(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    if (this.wantsArtifactProgress(request)) {
      this.beginArtifactProgress(response);
      try {
        const artifactId = request.params.artifactId;
        if (!ArtifactModel.isValidId(artifactId))
          throw new Error("无效的 artifact ID");
        const artifact = await this.artifacts.start(artifactId, (phase) =>
          this.writeArtifactProgress(response, { type: "progress", phase }),
        );
        this.writeArtifactProgress(response, { type: "complete", artifact });
      } catch (error) {
        this.writeArtifactProgress(response, {
          type: "error",
          error: error instanceof Error ? error.message : "无法启动产物预览",
        });
      } finally {
        response.end();
      }
      return;
    }
    try {
      const artifactId = request.params.artifactId;
      if (!ArtifactModel.isValidId(artifactId)) {
        response.status(400).json({ error: "无效的 artifact ID" });
        return;
      }
      response.json({ artifact: await this.artifacts.start(artifactId) });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "无法启动产物预览",
      });
    }
  }

  @Get("artifacts/:artifactId/checkpoints")
  async checkpoints(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const { artifactId } = request.params;
    if (!(await this.artifacts.exists(artifactId))) {
      response.status(404).json({ error: "找不到这个产物" });
      return;
    }
    await this.artifacts.initialize(artifactId);
    response.json(
      await this.artifacts.workspace(artifactId).versions.inspect(),
    );
  }

  @Post("artifacts/:artifactId/checkpoints/:version/preview")
  @HttpCode(200)
  async preview(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const { artifactId } = request.params;
    const version = this.checkpointVersion(request.params.version);
    if (!(await this.artifacts.exists(artifactId)) || !version) {
      response.status(400).json({ error: "产物或版本无效" });
      return;
    }
    response.json(
      await this.artifacts.transition(artifactId, "checkout", version),
    );
  }

  @Post("artifacts/:artifactId/checkpoints/:version/edit")
  @HttpCode(200)
  async edit(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const { artifactId } = request.params;
    const version = this.checkpointVersion(request.params.version);
    if (!(await this.artifacts.exists(artifactId)) || !version) {
      response.status(400).json({ error: "产物或版本无效" });
      return;
    }
    response.json(
      await this.artifacts.transition(artifactId, "beginEdit", version),
    );
  }

  @Post("artifacts/:artifactId/checkpoints/resume")
  @HttpCode(200)
  async resume(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const { artifactId } = request.params;
    if (!(await this.artifacts.exists(artifactId))) {
      response.status(404).json({ error: "找不到这个产物" });
      return;
    }
    response.json(await this.artifacts.transition(artifactId, "resume"));
  }

  @Get("sandbox/files")
  async files(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const artifactId =
      typeof request.query.artifactId === "string"
        ? request.query.artifactId
        : "";
    if (!(await this.artifacts.exists(artifactId))) {
      response.status(400).json({ error: "请选择有效的产物" });
      return;
    }
    const workspace = this.artifacts.workspace(artifactId);
    response.json({ root: workspace.root, ...(await workspace.files.list()) });
  }

  @Get("sandbox/file")
  async file(
    @Req() request: Request<Record<string, string>>,
    @Res() response: Response,
  ) {
    const artifactId =
      typeof request.query.artifactId === "string"
        ? request.query.artifactId
        : "";
    const filePath =
      typeof request.query.path === "string" ? request.query.path : "";
    if (!(await this.artifacts.exists(artifactId))) {
      response.status(400).json({ error: "请选择有效的产物" });
      return;
    }
    if (!filePath || filePath.length > 512) {
      response.status(400).json({ error: "文件路径无效" });
      return;
    }
    try {
      response.json(
        await this.artifacts.workspace(artifactId).files.read(filePath),
      );
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "无法读取沙箱文件",
      });
    }
  }

  private checkpointVersion(value: unknown) {
    const version = Number(value);
    return Number.isSafeInteger(version) && version > 0 ? version : null;
  }

  private wantsArtifactProgress(request: Request) {
    return request.get("accept")?.includes("application/x-ndjson");
  }

  private beginArtifactProgress(response: Response) {
    response.status(200);
    response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.flushHeaders();
  }

  private writeArtifactProgress(response: Response, event: unknown) {
    response.write(`${JSON.stringify(event)}\n`);
  }
}
