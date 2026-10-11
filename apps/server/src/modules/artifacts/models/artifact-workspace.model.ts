import path from "node:path";
import {
  requireSuccess,
  shellCommand,
  type BashOptions,
  type BashResult,
  type TextFile,
  type FileWriteResult,
  type FileTree,
  type ListOptions,
  type SearchResult,
} from "@artifact-editor/sdk/server";
import { ArtifactVersions } from "./artifact-versions.model.js";

export type WorkspaceExecutor = (
  command: string,
  options?: BashOptions,
) => Promise<BashResult>;
export interface WorkspaceFiles {
  read(file: string, options?: BashOptions): Promise<TextFile>;
  write(
    file: string,
    content: string,
    options?: BashOptions,
  ): Promise<FileWriteResult>;
  edit(
    file: string,
    oldText: string,
    newText: string,
    options?: BashOptions,
  ): Promise<FileWriteResult>;
  list(
    directory?: string,
    options?: BashOptions & ListOptions,
  ): Promise<FileTree & { defaultFile: string }>;
  search(
    query: string,
    options?: BashOptions & ListOptions & { path?: string },
  ): Promise<SearchResult>;
}
export type WorkspaceFileAccess = Omit<WorkspaceFiles, "list"> & {
  list(
    directory?: string,
    options?: BashOptions & ListOptions,
  ): Promise<FileTree>;
};
export interface DependencyOptions extends BashOptions {
  packages?: string[];
  persistLock?: boolean;
}
export interface WorkspaceExecution {
  root: string;
  execute: WorkspaceExecutor;
  files: WorkspaceFiles;
  prepareDependencies(options?: DependencyOptions): Promise<unknown>;
  build(options?: BashOptions): Promise<BashResult>;
}
export interface WorkspaceOptions {
  files: WorkspaceFileAccess;
  execute: WorkspaceExecutor;
  root: string;
  buildCommand?: string;
  prepareDependencies?: (
    workspace: WorkspaceExecution,
    options?: DependencyOptions,
  ) => Promise<unknown>;
}
export interface VersionOptions {
  message?: string;
  ignore?: string[];
  expectedRevision?: string;
}
export interface EditOptions extends VersionOptions {
  onError?: "rollback";
  verify?: (workspace: WorkspaceExecution) => Promise<unknown>;
}

/** Owns one artifact's serialized edits, build preparation and version transitions. */
export class ArtifactWorkspace {
  private static readonly queues = new WeakMap<
    WorkspaceOptions["files"],
    Map<string, Promise<void>>
  >();
  readonly root: string;

  readonly files: WorkspaceFiles;
  readonly versions: Pick<
    ArtifactVersions,
    | "initialize"
    | "list"
    | "status"
    | "inspect"
    | "checkout"
    | "beginEdit"
    | "resume"
    | "checkpoint"
    | "diff"
  >;
  private readonly execution: WorkspaceExecution;
  private readonly git: ArtifactVersions;

  constructor(private readonly options: WorkspaceOptions) {
    const { files: storage, root } = options;
    if (
      !path.posix.isAbsolute(root) ||
      root.includes("\0") ||
      root.includes("\\")
    )
      throw new TypeError("工作区必须使用沙箱内的绝对 POSIX 路径");
    this.root = path.posix.normalize(root).replace(/\/$/u, "") || "/";
    this.git = new ArtifactVersions((command, opts) =>
      this.executeUnlocked(command, opts),
    );
    const files: WorkspaceFiles = {
      read: (file, opts) =>
        storage.read(this.relativePath(file), { ...opts, cwd: this.root }),
      write: (file, content, opts) =>
        storage.write(this.relativePath(file), content, {
          ...opts,
          cwd: this.root,
        }),
      edit: (file, oldText, newText, opts) =>
        storage.edit(this.relativePath(file), oldText, newText, {
          ...opts,
          cwd: this.root,
        }),
      list: async (directory = ".", opts) => {
        const result = await storage.list(this.relativePath(directory), {
          ignore: ["node_modules", ".git", "dist", ".vite", ".artifact"],
          ...opts,
          cwd: this.root,
        });
        return {
          ...result,
          defaultFile:
            result.tree.find((entry) => entry.path === "index.html")?.path ??
            this.firstFile(result.tree),
        };
      },
      search: (query, opts = {}) =>
        storage.search(query, {
          ...opts,
          path: this.relativePath(opts.path ?? "."),
          cwd: this.root,
        }),
    };
    this.execution = {
      root: this.root,
      files,
      execute: (command, opts) => this.executeUnlocked(command, opts),
      prepareDependencies: async (opts) =>
        options.prepareDependencies?.(this.execution, opts),
      build: async (opts) => {
        if (!options.buildCommand)
          throw new Error("请为工作区配置 buildCommand");
        await this.execution.prepareDependencies(opts);
        return requireSuccess(
          await this.executeUnlocked(options.buildCommand, opts),
        );
      },
    };
    this.files = {
      read: (file, opts) => this.withLock(() => files.read(file, opts)),
      write: (file, content, opts) =>
        this.withLock(() => files.write(file, content, opts)),
      edit: (file, oldText, newText, opts) =>
        this.withLock(() => files.edit(file, oldText, newText, opts)),
      list: (directory, opts) =>
        this.withLock(() => files.list(directory, opts)),
      search: (query, opts) => this.withLock(() => files.search(query, opts)),
    };
    this.versions = {
      initialize: (opts) => this.withLock(() => this.git.initialize(opts)),
      list: (metadata) => this.withLock(() => this.git.list(metadata)),
      status: () => this.withLock(() => this.git.status()),
      inspect: () => this.withLock(() => this.git.inspect()),
      checkout: (version) => this.withLock(() => this.git.checkout(version)),
      beginEdit: (version) => this.withLock(() => this.git.beginEdit(version)),
      resume: () => this.withLock(() => this.git.resume()),
      checkpoint: (opts) => this.withLock(() => this.git.checkpoint(opts)),
      diff: (from, to) => this.withLock(() => this.git.diff(from, to)),
    };
  }

  execute(command: string, options?: BashOptions) {
    return this.withLock(() => this.execution.execute(command, options));
  }
  prepareDependencies(options?: DependencyOptions) {
    return this.withLock(() => this.execution.prepareDependencies(options));
  }
  build(options?: BashOptions) {
    return this.withLock(() => this.execution.build(options));
  }

  edit<T>(
    options: EditOptions,
    operation: (workspace: WorkspaceExecution) => Promise<T>,
  ) {
    return this.withLock(async () => {
      const before = await this.git.capture(options);
      let value: T;
      let checkpoint;
      try {
        value = await operation(this.execution);
        await options.verify?.(this.execution);
        await this.execution.prepareDependencies();
        checkpoint = await this.git.checkpoint({ message: options.message });
      } catch (error) {
        if (options.onError === "rollback") {
          try {
            await this.git.restore(before, true);
            await this.execution.prepareDependencies();
          } catch (recoveryError) {
            throw new AggregateError(
              [error, recoveryError],
              "编辑失败，文件恢复也失败",
            );
          }
        }
        throw error;
      }
      return {
        value,
        changed: checkpoint !== null,
        checkpoint,
        ...(await this.git.inspect()),
      };
    });
  }

  private executeUnlocked(command: string, options: BashOptions = {}) {
    return this.options.execute(command, { ...options, cwd: this.root });
  }
  private relativePath(value: string) {
    if (
      !value ||
      value.includes("\0") ||
      value.includes("\\") ||
      /^[A-Za-z]:/u.test(value) ||
      path.posix.isAbsolute(value)
    )
      throw new TypeError("请使用工作区内的相对路径");
    const normalized = path.posix.normalize(value);
    if (normalized === ".." || normalized.startsWith("../"))
      throw new Error("文件路径超出工作区目录");
    return normalized;
  }
  private firstFile(entries: FileTree["tree"]): string {
    for (const entry of entries) {
      if (entry.type === "file") return entry.path;
      const nested = this.firstFile(entry.children ?? []);
      if (nested) return nested;
    }
    return "";
  }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    let queues = ArtifactWorkspace.queues.get(this.options.files);
    if (!queues) {
      queues = new Map();
      ArtifactWorkspace.queues.set(this.options.files, queues);
    }
    const previous = queues.get(this.root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    queues.set(this.root, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (queues.get(this.root) === tail) queues.delete(this.root);
    }
  }
  static async resolveFile(
    execute: WorkspaceExecutor,
    file: string,
    options: BashOptions,
  ) {
    if (!file || file.includes("\0") || file.includes("\\"))
      throw new Error("文件路径无效");
    if (!options.cwd) {
      if (!path.posix.isAbsolute(file))
        throw new Error("请提供绝对路径或工作目录");
      return {
        absolute: path.posix.normalize(file),
        relative: path.posix.normalize(file),
      };
    }
    const absolute = path.posix.resolve(options.cwd, file);
    this.resultPath(options.cwd, absolute);
    const resolved = requireSuccess(
      await execute(
        shellCommand(["realpath", "-m", "-z", "--", options.cwd, absolute]),
        options,
      ),
    ).stdout.split("\0");
    if (!resolved[0] || !resolved[1]) throw new Error("无法解析沙箱文件路径");
    this.resultPath(resolved[0], resolved[1]);
    return {
      absolute,
      relative: path.posix.relative(options.cwd, absolute) || ".",
    };
  }

  static resultPath(root: string, file: string) {
    const relative = path.posix.isAbsolute(file)
      ? path.posix.relative(root, file)
      : path.posix.normalize(file);
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      path.posix.isAbsolute(relative) ||
      relative.includes("\0")
    )
      throw new Error("文件路径超出工作目录");
    return relative || ".";
  }
}
