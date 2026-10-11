import {
  ArgumentsHost,
  Catch,
  HttpException,
  ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      response.end();
      return;
    }
    const bodyError =
      error instanceof SyntaxError ||
      (error as { type?: string })?.type === "entity.too.large";
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : bodyError
          ? 400
          : 502;
    response.status(status).json({
      error: error instanceof Error ? error.message : "接口服务调用失败",
    });
  }
}
