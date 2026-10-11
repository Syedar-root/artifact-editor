import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  requireSuccess,
  shellCommand,
  type BashOptions,
} from "@artifact-editor/sdk/server";
import { ServerConfigService } from "../../../config/server-config.service.js";
import {
  SandboxClient,
  type SandboxApi as Sandbox,
} from "@agent-infra/sandbox";
import { SandboxCommandService } from "../../../infrastructure/sandbox/services/sandbox-command.service.js";
import {
  SandboxResponse,
  SandboxOperationError,
} from "../../../infrastructure/sandbox/models/sandbox-response.model.js";

export type DependencyOptions = {
  packages?: string[];
  signal?: AbortSignal;
  persistLock?: boolean;
};
type PackageManifest = {
  packageManager?: string;
  workspaces?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
type Installation = {
  root: string;
  store: string;
  project: string;
  manifest: PackageManifest;
  packageText: string;
  manager: "npm" | "pnpm";
  managerVersion: string;
  runtime: string;
  lockName: string;
  lockText: string;
  importLockText: string;
  npmrc: string;
  overlay: boolean;
};

/** 决策在 Server 中执行；远端只读写文件并运行包管理器和标准文件命令。 */
@Injectable()
export class DependenciesService {
  constructor(
    @Inject(SandboxClient) private readonly client: SandboxClient,
    @Inject(SandboxCommandService)
    private readonly commands: SandboxCommandService,
    @Inject(ServerConfigService)
    private readonly config: Pick<
      ServerConfigService,
      "dependencyRoot" | "packageManager"
    >,
  ) {}

  async ensure(root: string, options: DependencyOptions = {}) {
    const execution = {
      signal: options.signal,
      timeoutMs: 300_000,
      maxOutputBytes: 2 * 1024 * 1024,
    };
    const plan = await this.plan(root, options, execution);
    if (!plan) return { skipped: true };
    await this.command(["mkdir", "-p", "--", plan.project], execution);
    const requestKey = this.key(plan, plan.lockText);
    const index = path.posix.join(plan.project, `.request-${requestKey}`);
    const cachedKey = await this.text(index, execution);
    if (cachedKey && !/^[0-9a-f]{64}$/u.test(cachedKey))
      throw new Error("依赖缓存索引无效");
    let target = path.posix.join(plan.project, cachedKey || requestKey);
    const cached =
      (await this.exists(path.posix.join(target, ".complete"), execution)) &&
      (await this.exists(path.posix.join(target, "node_modules"), execution));
    if (!cached) {
      target = await this.install(plan, execution);
      const temporary = `${index}-${randomUUID()}`;
      await this.write(temporary, path.posix.basename(target), execution);
      await this.command(["mv", "-fT", "--", temporary, index], execution);
    }
    if (options.persistLock !== false && !plan.overlay) {
      const lock = await this.text(
        path.posix.join(target, plan.lockName),
        execution,
      );
      if (lock && lock !== plan.lockText)
        await this.write(
          path.posix.join(plan.root, plan.lockName),
          lock,
          execution,
        );
    }
    await this.link(plan, target, execution);
    return { directory: path.posix.join(target, "node_modules"), cached };
  }

  private async plan(
    root: string,
    options: DependencyOptions,
    execution: BashOptions,
  ): Promise<Installation | null> {
    await this.command(
      ["mkdir", "-p", "--", this.config.dependencyRoot],
      execution,
    );
    const rootPath = (
      await this.command(["realpath", "--", root], execution)
    ).trim();
    const store = (
      await this.command(
        ["realpath", "--", this.config.dependencyRoot],
        execution,
      )
    ).trim();
    if (this.inside(rootPath, store) || this.inside(store, rootPath))
      throw new Error("依赖路径必须与产物目录分离");
    const original = await this.text(
      path.posix.join(rootPath, "package.json"),
      execution,
    );
    if (original === null) return null;
    const manifest: PackageManifest = JSON.parse(original);
    this.validateManifest(manifest);
    if (
      manifest.workspaces ||
      (await this.exists(
        path.posix.join(rootPath, "pnpm-workspace.yaml"),
        execution,
      ))
    )
      throw new Error("独立依赖安装暂不支持 workspaces 产物");
    const pnpmLock = await this.text(
      path.posix.join(rootPath, "pnpm-lock.yaml"),
      execution,
    );
    const shrinkwrap = await this.text(
      path.posix.join(rootPath, "npm-shrinkwrap.json"),
      execution,
    );
    const npmLock =
      shrinkwrap ??
      (await this.text(
        path.posix.join(rootPath, "package-lock.json"),
        execution,
      ));
    const selected =
      manifest.packageManager?.split("@")[0] ||
      (pnpmLock !== null
        ? "pnpm"
        : npmLock !== null
          ? "npm"
          : this.config.packageManager);
    if (selected !== "npm" && selected !== "pnpm")
      throw new Error("产物依赖安装仅支持 npm 或 pnpm");
    const managerVersion = (
      await this.command([selected, "--version"], execution)
    ).trim();
    const pinned = manifest.packageManager?.match(
      /^(?:npm|pnpm)@(\d+\.\d+\.\d+(?:-[^+]+)?)(?:\+.*)?$/u,
    )?.[1];
    if (pinned && pinned !== managerVersion)
      throw new Error(
        `产物要求 ${selected}@${pinned}，沙箱当前为 ${selected}@${managerVersion}`,
      );
    let overlay = false;
    for (const name of options.packages ?? []) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name))
        throw new Error("依赖包名称无效");
      if (!manifest.dependencies?.[name] && !manifest.devDependencies?.[name]) {
        manifest.devDependencies = {
          ...manifest.devDependencies,
          [name]: "latest",
        };
        overlay = true;
      }
    }
    return {
      root: rootPath,
      store,
      project: path.posix.join(
        store,
        "projects",
        createHash("sha256").update(rootPath).digest("hex").slice(0, 24),
      ),
      manifest,
      packageText: overlay
        ? JSON.stringify(manifest, null, 2) + "\n"
        : original,
      manager: selected,
      managerVersion,
      runtime: requireSuccess(
        await this.commands.run("node --version && uname -sm", execution),
      ).stdout.trim(),
      lockName:
        selected === "pnpm"
          ? "pnpm-lock.yaml"
          : shrinkwrap !== null
            ? "npm-shrinkwrap.json"
            : "package-lock.json",
      lockText: (selected === "pnpm" ? pnpmLock : npmLock) ?? "",
      importLockText:
        selected === "pnpm" && pnpmLock === null ? (npmLock ?? "") : "",
      npmrc:
        (await this.text(path.posix.join(rootPath, ".npmrc"), execution)) ?? "",
      overlay,
    };
  }

  private async install(plan: Installation, execution: BashOptions) {
    const stage = (
      await this.command(
        [
          "mktemp",
          "-d",
          "--",
          path.posix.join(plan.project, ".install-XXXXXX"),
        ],
        execution,
      )
    ).trim();
    if (
      !stage.startsWith(`${plan.project}/.install-`) ||
      path.posix.dirname(stage) !== plan.project
    )
      throw new Error("沙箱返回了无效的安装目录");
    try {
      // 根项目的生命周期脚本依赖源码，不能在仅含清单的 staging 中执行。
      const { scripts: _scripts, ...installationManifest } = plan.manifest;
      await this.write(
        path.posix.join(stage, "package.json"),
        JSON.stringify(installationManifest, null, 2),
        execution,
      );
      if (plan.lockText)
        await this.write(
          path.posix.join(stage, plan.lockName),
          plan.lockText,
          execution,
        );
      if (plan.npmrc)
        await this.write(
          path.posix.join(stage, ".npmrc"),
          plan.npmrc,
          execution,
        );
      if (plan.manager === "pnpm")
        await this.installPnpm(plan, stage, execution);
      else
        await this.command(
          [
            "npm",
            this.npmLockMatches(plan) && !plan.overlay ? "ci" : "install",
            "--package-lock=true",
            "--include=dev",
            "--no-audit",
            "--no-fund",
            "--cache",
            path.posix.join(plan.store, "npm-cache"),
          ],
          { ...execution, cwd: stage },
        );
      const finalLock =
        (await this.text(path.posix.join(stage, plan.lockName), execution)) ??
        plan.lockText;
      const target = path.posix.join(plan.project, this.key(plan, finalLock));
      await this.command(
        ["mkdir", "-p", "--", path.posix.join(stage, "node_modules")],
        execution,
      );
      await this.write(
        path.posix.join(stage, "package.json"),
        plan.packageText,
        execution,
      );
      await this.write(path.posix.join(stage, ".complete"), "1", execution);
      if (await this.exists(target, execution)) {
        if (
          !(await this.exists(path.posix.join(target, ".complete"), execution))
        )
          throw new Error(`依赖缓存不完整，请清理后重试：${target}`);
      } else await this.command(["mv", "-T", "--", stage, target], execution);
      return target;
    } finally {
      // 用户取消安装后也要清除本次创建的 staging；保留当前依赖和历史缓存。
      await this.command(["rm", "-rf", "--", stage], { timeoutMs: 30_000 });
    }
  }

  private async installPnpm(
    plan: Installation,
    stage: string,
    execution: BashOptions,
  ) {
    const common = [
      "--ignore-workspace",
      `--config.store-dir=${plan.store}/pnpm-store`,
      `--config.cache-dir=${plan.store}/pnpm-cache`,
      `--config.state-dir=${plan.store}/pnpm-state`,
      "--config.manage-package-manager-versions=false",
    ];
    if (plan.importLockText) {
      await this.write(
        path.posix.join(stage, "package-lock.json"),
        plan.importLockText,
        execution,
      );
      await this.command(["pnpm", "import", ...common], {
        ...execution,
        cwd: stage,
      });
      await this.command(
        ["rm", "--", path.posix.join(stage, "package-lock.json")],
        execution,
      );
    }
    await this.command(
      [
        "pnpm",
        "install",
        "--no-frozen-lockfile",
        "--prod=false",
        "--reporter=append-only",
        "--config.node-linker=hoisted",
        "--config.modules-dir=node_modules",
        "--config.dangerously-allow-all-builds=true",
        "--config.package-import-method=hardlink",
        ...common,
      ],
      { ...execution, cwd: stage },
    );
  }

  private async link(
    plan: Installation,
    target: string,
    execution: BashOptions,
  ) {
    const link = path.posix.join(plan.root, "node_modules");
    const symbolic = await this.test(["-L", link], execution);
    if (!symbolic && (await this.exists(link, execution))) {
      const legacy = path.posix.join(plan.project, `legacy-${randomUUID()}`);
      // GNU mv 支持跨 NAS/SSD 文件系统迁移，保留旧依赖供后续清理。
      await this.command(["mv", "-T", "--", link, legacy], execution);
    }
    const temporary = path.posix.join(
      plan.root,
      `.node_modules-${randomUUID()}`,
    );
    try {
      await this.command(
        ["ln", "-s", "--", path.posix.join(target, "node_modules"), temporary],
        execution,
      );
      await this.command(["mv", "-fT", "--", temporary, link], execution);
    } finally {
      await this.command(["rm", "-f", "--", temporary], { timeoutMs: 30_000 });
    }
  }

  private validateManifest(manifest: PackageManifest) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
      throw new Error("package.json 必须是对象");
    for (const group of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
    ]) {
      for (const version of Object.values(group ?? {})) {
        if (typeof version !== "string")
          throw new Error("依赖版本必须是字符串");
        if (/^(file:|link:|workspace:|\.\.?\/|\/)/u.test(version))
          throw new Error("独立依赖安装暂不支持本地路径依赖");
      }
    }
  }

  private npmLockMatches(plan: Installation) {
    if (!plan.lockText) return false;
    const lockedRoot = JSON.parse(plan.lockText).packages?.[""] as
      | PackageManifest
      | undefined;
    const signature = (group?: Record<string, string>) =>
      JSON.stringify(
        Object.entries(group ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      );
    return (
      !!lockedRoot &&
      (
        [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ] as const
      ).every(
        (group) =>
          signature(lockedRoot[group]) === signature(plan.manifest[group]),
      )
    );
  }

  private key(plan: Installation, lock: string) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          plan.packageText,
          plan.manager,
          plan.managerVersion,
          "external-sdk-v2",
          plan.lockName,
          lock,
          lock ? "" : plan.importLockText,
          plan.npmrc,
          plan.runtime,
        ]),
      )
      .digest("hex");
  }

  private inside(parent: string, child: string) {
    const relative = path.posix.relative(parent, child);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith("../") &&
        !path.posix.isAbsolute(relative))
    );
  }
  private async text(file: string, options: BashOptions) {
    try {
      const { content } = SandboxResponse.data<Sandbox.FileReadResult>(
        await this.client.file.readFile(
          { file },
          { abortSignal: options.signal },
        ),
      );
      if (Buffer.byteLength(content) > 1024 * 1024)
        throw new Error("文件超过读取大小限制");
      if (content.includes("\0"))
        throw new Error("这是二进制文件，暂不支持文本读取");
      return content;
    } catch (error) {
      if (error instanceof SandboxOperationError && error.code === "not_found")
        return null;
      throw error;
    }
  }
  private async write(file: string, content: string, options: BashOptions) {
    SandboxResponse.data(
      await this.client.file.writeFile(
        {
          file,
          content,
          encoding: "utf-8",
          append: false,
          leading_newline: false,
          trailing_newline: false,
        },
        { abortSignal: options.signal },
      ),
    );
  }
  private async command(args: string[], options: BashOptions) {
    return requireSuccess(await this.commands.run(shellCommand(args), options))
      .stdout;
  }
  private async test(args: string[], options: BashOptions) {
    const result = await this.commands.run(
      shellCommand(["test", ...args]),
      options,
    );
    if (result.exitCode > 1 || result.truncated) requireSuccess(result);
    return result.exitCode === 0;
  }
  private exists(file: string, options: BashOptions) {
    return this.test(["-e", file], options);
  }
}
