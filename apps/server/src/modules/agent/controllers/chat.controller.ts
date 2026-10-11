import { Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ChatService } from "../services/chat.service.js";

@Controller("api/chat")
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Post()
  @HttpCode(200)
  async send(@Req() request: Request, @Res() response: Response) {
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("请求已取消"));
    const close = () => {
      if (!response.writableEnded) cancel();
    };
    request.once("aborted", cancel);
    response.once("close", close);
    try {
      response.json(await this.chat.send(request.body, controller.signal));
    } finally {
      request.removeListener("aborted", cancel);
      response.removeListener("close", close);
    }
  }
}
