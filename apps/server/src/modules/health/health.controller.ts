import { Controller, Get } from "@nestjs/common";

@Controller("api/health")
export class HealthController {
  @Get()
  health() {
    return { ok: true, agent: "dsh", sandbox: "aio-sdk" };
  }
}
