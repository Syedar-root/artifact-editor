import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import {
  requireSuccess,
  shellCommand,
  type BashOptions,
  type FileEntry,
  type TextFile,
  type FileWriteResult,
  type FileTree,
  type ListOptions,
  type SearchResult,
} from "@artifact-editor/sdk/server";
import {
  SandboxClient,
  type SandboxApi as Sandbox,
} from "@agent-infra/sandbox";
import { SandboxCommandService } from "../../../infrastructure/sandbox/services/sandbox-command.service.js";
import {
  SandboxResponse,
  SandboxOperationError,
} from "../../../infrastructure/sandbox/models/sandbox-response.model.js";
import { ArtifactWorkspace } from "../models/artifact-workspace.model.js";
import { ArtifactTemplateService } from "./artifact-template.service.js";
import {
  ArtifactModel,
  type ArtifactMetadata,
  type TechnologyStack,
  type LocatorMode,
} from "../models/artifact.model.js";

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

@Injectable()
export class ArtifactFilesystemService {
  constructor(
    @Inject(SandboxClient) private readonly client: SandboxClient,
    @Inject(SandboxCommandService)
    private readonly commands: SandboxCommandService,
    @Inject(ArtifactTemplateService)
    private readonly templates: ArtifactTemplateService,
  ) {}

  async discover(
    root: string,
    previewPort: number,
    options: BashOptions = {},
  ): Promise<ArtifactMetadata[]> {
    requireSuccess(
      await this.commands.run(
        shellCommand(["mkdir", "-p", "--", root]),
        options,
      ),
    );
    const entries = await this.entries(root, options);
    const artifacts: ArtifactMetadata[] = [];
    for (const entry of entries
      .filter((item) => item.is_directory && ArtifactModel.isValidId(item.name))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const artifact = await this.describe(
        root,
        entry.name,
        previewPort,
        options,
        entry.modified_time,
      );
      if (artifact) artifacts.push(artifact);
    }
    return artifacts;
  }

  async describe(
    workspaceRoot: string,
    id: string,
    previewPort: number,
    options: BashOptions = {},
    createdAt?: string,
  ): Promise<ArtifactMetadata | null> {
    if (!ArtifactModel.isValidId(id)) throw new Error("无效的 artifact ID");
    const root = path.posix.join(workspaceRoot, id);
    const packageFile = await this.readOptional("package.json", {
      ...options,
      cwd: root,
    });
    if (
      !packageFile &&
      !(await this.readOptional("index.html", {
        ...options,
        cwd: root,
      }))
    )
      return null;
    const manifest = this.parse<Manifest>(packageFile?.content) ?? {};
    const metadataFile = await this.readOptional(".artifact/metadata.json", {
      ...options,
      cwd: root,
    });
    const metadata =
      this.parse<Partial<ArtifactMetadata>>(metadataFile?.content) ?? {};
    const detectedStack = await this.detectStack(root, manifest, options);
    const plugin =
      detectedStack !== "html" &&
      (await this.readOptional(
        path.posix.join(
          root,
          "node_modules/code-inspector-plugin/package.json",
        ),
        options,
      ));
    const normalized: ArtifactMetadata = {
      id,
      name:
        typeof metadata.name === "string" && metadata.name.trim()
          ? metadata.name.trim()
          : (typeof manifest.name === "string" && manifest.name.trim()) || id,
      previewPort,
      createdAt:
        typeof metadata.createdAt === "string"
          ? metadata.createdAt
          : createdAt || new Date().toISOString(),
      requestedStack: ["html", "react", "vue"].includes(
        metadata.requestedStack ?? "",
      )
        ? metadata.requestedStack!
        : detectedStack,
      detectedStack,
      locatorMode: plugin ? "code-inspector" : "runtime-hint",
    };
    const text = JSON.stringify(normalized, null, 2) + "\n";
    if (metadataFile?.content !== text)
      await this.write(".artifact/metadata.json", text, {
        ...options,
        cwd: root,
      });
    return normalized;
  }

  async create(
    workspaceRoot: string,
    id: string,
    name: string,
    previewPort: number,
    stack: TechnologyStack,
  ): Promise<ArtifactMetadata> {
    if (
      !ArtifactModel.isValidId(id) ||
      !["html", "react", "vue"].includes(stack)
    )
      throw new Error("产物参数无效");
    const root = path.posix.join(workspaceRoot, id);
    const result = await this.commands.run(shellCommand(["mkdir", "--", root]));
    if (result.exitCode !== 0)
      throw new Error(`无法创建产物目录（可能已经存在）：${result.stderr}`);
    const metadata: ArtifactMetadata = {
      id,
      name,
      previewPort,
      createdAt: new Date().toISOString(),
      requestedStack: stack,
      detectedStack: stack,
      locatorMode: stack === "html" ? "runtime-hint" : "code-inspector",
    };
    for (const [file, content] of Object.entries(
      this.templates.files(id, name, stack),
    ))
      await this.write(file, content, { cwd: root });
    await this.write(
      ".artifact/metadata.json",
      JSON.stringify(metadata, null, 2) + "\n",
      { cwd: root },
    );
    return metadata;
  }

  async configurePreview(
    root: string,
    stack: TechnologyStack,
    locator: LocatorMode,
  ) {
    const config = this.templates.preview(stack, locator);
    const previous = await this.readOptional(".artifact/vite.config.mjs", {
      cwd: root,
    });
    const changed = previous?.content !== config;
    if (changed)
      await this.write(".artifact/vite.config.mjs", config, {
        cwd: root,
      });
    return { changed };
  }

  private async detectStack(
    root: string,
    manifest: Manifest,
    options: BashOptions,
  ): Promise<TechnologyStack> {
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    let react = dependencies.react || dependencies["react-dom"] ? 2 : 0;
    let vue = dependencies.vue ? 2 : 0;
    const source = (await this.entries(root, options)).find(
      (entry) => entry.name === "src" && entry.is_directory,
    );
    if (source) {
      const listing = await this.list("src", {
        ...options,
        cwd: root,
        maxEntries: 200,
      });
      for (const file of this.files(listing.tree).slice(0, 200)) {
        if (/\.vue$/iu.test(file)) vue += 5;
        if (/\.(jsx|tsx)$/iu.test(file)) react += 4;
        if (!/\.(js|jsx|ts|tsx|vue)$/iu.test(file)) continue;
        let content;
        try {
          content = await this.read(file, {
            ...options,
            cwd: root,
            maxBytes: 256 * 1024,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "文件超过读取大小限制"
          )
            continue;
          throw error;
        }
        if (/from\s+["']react(?:-dom)?(?:\/[^"']*)?["']/u.test(content.content))
          react += 4;
        if (/from\s+["']vue["']/u.test(content.content)) vue += 4;
      }
    }
    if (vue > react) return "vue";
    if (react > vue) return "react";
    return dependencies.vue
      ? "vue"
      : dependencies.react || dependencies["react-dom"]
        ? "react"
        : "html";
  }

  private files(entries: FileEntry[]): string[] {
    return entries.flatMap((entry) =>
      entry.children ? this.files(entry.children) : [entry.path],
    );
  }
  private parse<T>(text?: string): T | null {
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
    } catch {
      return null;
    }
  }
  async read(
    file: string,
    options: BashOptions & { maxBytes?: number } = {},
  ): Promise<TextFile> {
    const target = await ArtifactWorkspace.resolveFile(
      (command, opts) => this.commands.run(command, opts),
      file,
      options,
    );
    const data = SandboxResponse.data<Sandbox.FileReadResult>(
      await this.client.file.readFile(
        { file: target.absolute },
        { abortSignal: options.signal },
      ),
    );
    const size = Buffer.byteLength(data.content);
    if (size > (options.maxBytes ?? 1024 * 1024))
      throw new Error("文件超过读取大小限制");
    if (data.content.includes("\0"))
      throw new Error("这是二进制文件，暂不支持文本读取");
    return { path: target.relative, content: data.content, size };
  }

  async readOptional(
    file: string,
    options: BashOptions = {},
  ): Promise<TextFile | null> {
    try {
      return await this.read(file, options);
    } catch (error) {
      if (error instanceof SandboxOperationError && error.code === "not_found")
        return null;
      throw error;
    }
  }

  async write(
    file: string,
    content: string,
    options: BashOptions = {},
  ): Promise<FileWriteResult> {
    const target = await ArtifactWorkspace.resolveFile(
      (command, opts) => this.commands.run(command, opts),
      file,
      options,
    );
    SandboxResponse.data(
      await this.client.file.writeFile(
        {
          file: target.absolute,
          content,
          encoding: "utf-8",
          append: false,
          leading_newline: false,
          trailing_newline: false,
        },
        { abortSignal: options.signal },
      ),
    );
    return { path: target.relative, size: Buffer.byteLength(content) };
  }

  async edit(
    file: string,
    oldText: string,
    newText: string,
    options: BashOptions & { replaceAll?: boolean } = {},
  ): Promise<FileWriteResult> {
    if (!oldText) throw new Error("被替换内容不能为空");
    const current = await this.read(file, options);
    const pieces = current.content.split(oldText);
    if (pieces.length === 1) throw new Error("找不到需要替换的内容");
    if (pieces.length !== 2 && !options.replaceAll)
      throw new Error("匹配到多处内容，请提供更准确的片段");
    return this.write(file, pieces.join(newText), options);
  }

  async list(
    directory = ".",
    options: BashOptions & ListOptions = {},
  ): Promise<FileTree> {
    const target = await ArtifactWorkspace.resolveFile(
      (command, opts) => this.commands.run(command, opts),
      directory,
      options,
    );
    const maxEntries = options.maxEntries ?? 1000,
      maxDepth = options.maxDepth ?? 10;
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(maxDepth) ||
      maxDepth < 0
    )
      throw new Error("文件操作限制无效");
    const data = SandboxResponse.data<Sandbox.FileGlobResult>(
      await this.client.file.globFiles(
        {
          path: target.absolute,
          pattern: "**/*",
          include_hidden: true,
          files_only: false,
          include_metadata: true,
          max_results: maxEntries + 1,
          sort_by: "path",
          exclude: this.excludes(options.ignore),
        },
        { abortSignal: options.signal },
      ),
    );
    const tree: FileEntry[] = [],
      directories = new Map<string, FileEntry[]>();
    directories.set(".", tree);
    let truncated = data.truncated ?? false;
    const entries = data.files ?? [];
    if (entries.length > maxEntries) truncated = true;
    for (const file of entries
      .slice(0, maxEntries)
      .sort((a, b) => a.path.localeCompare(b.path))) {
      const relative = ArtifactWorkspace.resultPath(target.absolute, file.path);
      if (relative.split("/").length > maxDepth + 1) {
        truncated = true;
        continue;
      }
      const entry: FileEntry = {
        name: path.posix.basename(relative),
        path: path.posix.join(target.relative, relative),
        type: file.is_directory ? "directory" : "file",
      };
      if (file.is_directory) {
        entry.children = [];
        directories.set(relative, entry.children);
      }
      directories.get(path.posix.dirname(relative))?.push(entry);
    }
    this.sortTree(tree);
    return { tree, truncated };
  }

  async search(
    query: string,
    options: BashOptions &
      ListOptions & { path?: string; maxResults?: number } = {},
  ): Promise<SearchResult> {
    if (!query || query.includes("\n")) throw new Error("请提供单行搜索内容");
    const target = await ArtifactWorkspace.resolveFile(
      (command, opts) => this.commands.run(command, opts),
      options.path ?? ".",
      options,
    );
    const data = SandboxResponse.data<Sandbox.FileGrepResult>(
      await this.client.file.grepFiles(
        {
          path: target.absolute,
          pattern: query,
          fixed_strings: true,
          exclude: this.excludes(options.ignore),
          max_results: options.maxResults ?? 100,
        },
        { abortSignal: options.signal },
      ),
    );
    return {
      matches: (data.matches ?? []).map((match) => ({
        path: path.posix.join(
          target.relative,
          ArtifactWorkspace.resultPath(target.absolute, match.file),
        ),
        line: match.line_number,
        text: match.line_content,
      })),
      truncated: data.truncated ?? false,
    };
  }

  async entries(directory: string, options: BashOptions = {}) {
    const target = await ArtifactWorkspace.resolveFile(
      (command, opts) => this.commands.run(command, opts),
      directory,
      options,
    );
    return (
      SandboxResponse.data<Sandbox.FileListResult>(
        await this.client.file.listPath(
          {
            path: target.absolute,
            recursive: false,
            show_hidden: true,
            include_size: true,
          },
          { abortSignal: options.signal },
        ),
      ).files ?? []
    );
  }

  private excludes(
    ignore = ["node_modules", ".git", "dist", ".vite", ".artifact"],
  ) {
    return ignore.flatMap((name) => [name, `**/${name}`, `**/${name}/**`]);
  }

  private sortTree(entries: FileEntry[]) {
    entries.sort(
      (a, b) =>
        Number(b.type === "directory") - Number(a.type === "directory") ||
        a.name.localeCompare(b.name),
    );
    for (const entry of entries)
      if (entry.children) this.sortTree(entry.children);
  }
}
