import { Context } from "@deepseek-ai/cordis";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LlmRuntime, {
  createUserMessage,
  type LlmAdapter,
  type Message,
} from "@deepseek-ai/dsh-llm";
import * as PiAiProvider from "@deepseek-ai/dsh-llm-pi-ai";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import SessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import SessionProjections from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { type ToolDefinition } from "@deepseek-ai/dsh-tools";
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from "@deepseek-ai/dsh-launch-environment";
import { SessionModel } from "../models/session.model.js";

export interface ModelConfiguration {
  model: string;
  provider?: string;
  adapter?: LlmAdapter;
  apiKey?: string;
  baseURL?: string;
}
export interface DshRuntimeOptions {
  sessionRoot: string;
  model:
    | ModelConfiguration
    | (() => ModelConfiguration | Promise<ModelConfiguration>);
  plugins?: Array<[any, any]>;
}
export interface DshRunOptions {
  cwd: string;
  sessionId: string;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  signal?: AbortSignal;
}

// The host owns the runtime, credentials and session store. No agent process runs in Docker.
@Injectable()
export class DshRuntimeService implements OnModuleDestroy {
  private starting?: Promise<Context>;
  private modelStarting?: Promise<{ provider: string; model: string }>;
  private readonly sessionRoot: string;
  private readonly model:
    | ModelConfiguration
    | (() => ModelConfiguration | Promise<ModelConfiguration>);
  private readonly plugins: Array<[any, any]>;

  constructor(options: DshRuntimeOptions) {
    this.sessionRoot = options.sessionRoot;
    this.model = options.model;
    this.plugins = options.plugins ?? [];
  }

  private visibleText(message: Message) {
    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  async context() {
    if (!this.starting)
      this.starting = this.initialize().catch((error) => {
        this.starting = undefined;
        throw error;
      });
    return this.starting;
  }

  private async initialize() {
    const ctx = new Context();
    try {
      for (const plugin of [
        SessionStore,
        SessionProjections,
        SystemPrompt,
        LlmRuntime,
        ToolRuntime,
        AgentRegistry,
      ])
        await ctx.plugin(plugin);
      await ctx.plugin(SessionPersistence, {
        root: this.sessionRoot,
        compression: "none",
      });
      await ctx.plugin(AgentLoop, { maxParallelToolCalls: 1 });
      for (const [plugin, config] of this.plugins)
        await ctx.plugin(plugin, config);
      return ctx;
    } catch (error) {
      await ctx.fiber.dispose();
      throw error;
    }
  }

  private async configureModel(ctx: Context) {
    if (!this.modelStarting)
      this.modelStarting = this.initializeModel(ctx).catch((error) => {
        this.modelStarting = undefined;
        throw error;
      });
    return this.modelStarting;
  }

  private async initializeModel(ctx: Context) {
    const config =
      typeof this.model === "function" ? await this.model() : this.model;
    const provider =
      config.provider ||
      (config.baseURL && new URL(config.baseURL).hostname === "api.deepseek.com"
        ? "deepseek"
        : "artifact-model");
    if (config.adapter) {
      ctx.llm.registerAdapter([provider], config.adapter);
    } else {
      ctx.provide(
        DSH_LAUNCH_ENVIRONMENT_KEY,
        createLaunchEnvironmentSnapshot([
          {
            source: "process",
            values: { ARTIFACT_MODEL_API_KEY: config.apiKey ?? "" },
          },
        ]),
      );
      // DSH's transport adapter uses pi-ai internally; it does not start pi-coding-agent.
      await ctx.plugin(PiAiProvider, {
        providers: {
          [provider]: {
            api: "openai-completions",
            baseURL: config.baseURL,
            apiKeyEnv: "ARTIFACT_MODEL_API_KEY",
            models: [{ id: config.model }],
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
            },
          },
        },
      });
    }
    return { provider, model: config.model };
  }

  async run(
    message: string,
    { cwd, sessionId, tools = [], systemPrompt = "", signal }: DshRunOptions,
  ) {
    if (!SessionModel.isValidId(sessionId))
      throw new Error("无效的 session ID");
    signal?.throwIfAborted();
    const ctx = await this.context();
    const model = await this.configureModel(ctx);
    const id = SessionId(sessionId);
    const existing = await ctx.sessionPersistence.stat(id);
    if (existing && existing.header.cwd !== cwd)
      throw new Error("这个会话不属于当前产物");
    let failure: unknown;
    const setup = (agentCtx: Context) => {
      if (systemPrompt)
        agentCtx.systemPrompt.section({
          name: "application",
          order: 0,
          interpolate: false,
          text: systemPrompt,
        });
      for (const tool of tools) agentCtx.tools.register(tool);
      agentCtx.on("agent/error", (payload) => {
        failure = payload.error;
      });
    };
    const options = { agentOptions: model, setup, signal };
    const handle = existing
      ? await ctx.agents.resume({ ...options, resumeSessionId: id })
      : await ctx.agents.create({ ...options, sessionId: id, meta: { cwd } });
    const cancel = () => handle.agent.cancel({ kind: "user" });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      signal?.throwIfAborted();
      const before = handle.agent.session.deriveMessages().length;
      handle.agent.followup(
        createUserMessage({
          content: [{ type: "text", text: message }],
          source: { kind: "user" },
        }),
      );
      await handle.agent.whenIdle();
      signal?.throwIfAborted();
      if (failure) throw failure;
      const reply = handle.agent.session
        .deriveMessages()
        .slice(before)
        .filter((item) => item.role === "assistant")
        .map((message) => this.visibleText(message))
        .filter(Boolean)
        .join("\n\n");
      if (!reply) throw new Error("DSH Agent 没有返回内容");
      await ctx.sessionPersistence.flush();
      return reply;
    } finally {
      signal?.removeEventListener("abort", cancel);
      await handle.dispose();
    }
  }

  async close() {
    if (this.starting) {
      const ctx = await this.starting;
      await ctx.fiber.dispose();
      this.starting = undefined;
      this.modelStarting = undefined;
    }
  }
  async onModuleDestroy() {
    await this.close();
  }
}
