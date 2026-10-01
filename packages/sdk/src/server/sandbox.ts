import path from "node:path";
import { shellCommand } from "./shell.ts";

export interface BashOptions {
  cwd?: string;
  stdin?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

export interface TextFile { path: string; content: string; size: number }
export interface FileWriteResult { path: string; size: number }
export interface FileEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: FileEntry[];
}
export interface FileTree { tree: FileEntry[]; truncated: boolean }
export interface FileMatch { path: string; line: number; text: string }
export interface SearchResult { matches: FileMatch[]; truncated: boolean }
export interface ListOptions {
  ignore?: string[];
  maxEntries?: number;
  maxDepth?: number;
}

/** Command failures return an exit code; transport failures, timeout and cancellation reject. */
export function requireSuccess(result: BashResult): BashResult {
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `命令执行失败：${result.exitCode}`);
  if (result.truncated) throw new Error("命令输出超过大小限制");
  return result;
}

function limit(value: number | undefined, fallback: number, minimum = 1): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum) throw new TypeError("文件操作限制无效");
  return result;
}

/** 适配器只实现 bash；预定义方法在 SDK 端组合系统命令、处理结果。 */
export abstract class Sandbox {
  abstract bash(command: string, options?: BashOptions): Promise<BashResult>;

  private async resolveFile(file: string, options: BashOptions) {
    if (!file || file.includes("\0")) throw new TypeError("文件路径无效");
    const result = requireSuccess(await this.bash(shellCommand(["realpath", "-m", "-z", "--", ".", file]), options));
    const [root, absolute] = result.stdout.split("\0");
    if (!root || !absolute) throw new Error("无法解析文件路径");
    const relative = path.posix.relative(root, absolute);
    if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
      throw new Error("文件路径超出工作目录");
    }
    return { absolute, relative };
  }

  async read(file: string, options: BashOptions & { maxBytes?: number } = {}): Promise<TextFile> {
    const target = await this.resolveFile(file, options);
    const maxBytes = limit(options.maxBytes, 1024 * 1024);
    const size = Number(requireSuccess(await this.bash(
      `${shellCommand(["test", "-f", target.absolute])} && wc -c < ${shellCommand([target.absolute])}`, options,
    )).stdout.trim());
    if (size > maxBytes) throw new Error("文件超过读取大小限制");
    const result = requireSuccess(await this.bash(shellCommand(["cat", "--", target.absolute]), {
      ...options, maxOutputBytes: Math.min(options.maxOutputBytes ?? maxBytes, maxBytes),
    }));
    if (result.stdout.includes("\0")) throw new Error("这是二进制文件，暂不支持文本读取");
    return { path: target.relative, content: result.stdout, size };
  }

  async write(file: string, content: string, options: BashOptions = {}): Promise<FileWriteResult> {
    const target = await this.resolveFile(file, options);
    requireSuccess(await this.bash(
      `${shellCommand(["mkdir", "-p", "--", path.posix.dirname(target.absolute)])} && cat > ${shellCommand([target.absolute])}`,
      { ...options, stdin: content },
    ));
    return { path: target.relative, size: Buffer.byteLength(content) };
  }

  async edit(file: string, oldText: string, newText: string,
    options: BashOptions & { replaceAll?: boolean } = {}): Promise<FileWriteResult> {
    if (!oldText) throw new Error("被替换内容不能为空");
    const { content } = await this.read(file, options);
    const parts = content.split(oldText);
    if (parts.length === 1) throw new Error("找不到需要替换的内容");
    if (parts.length !== 2 && !options.replaceAll) throw new Error("匹配到多处内容，请提供更准确的片段");
    return this.write(file, parts.join(newText), options);
  }

  async list(directory = ".", options: BashOptions & ListOptions = {}): Promise<FileTree> {
    const target = await this.resolveFile(directory, options);
    const maxEntries = limit(options.maxEntries, 1000);
    const maxDepth = limit(options.maxDepth, 10, 0);
    const args = ["find", target.absolute, "-mindepth", "1", "-maxdepth", String(maxDepth + 1)];
    const ignored = options.ignore ?? ["node_modules", ".git", "dist", ".vite"];
    if (ignored.length) {
      args.push("(");
      ignored.forEach((name, index) => {
        if (index) args.push("-o");
        args.push("-name", name.replace(/[\\*?\[\]]/gu, "\\$&"));
      });
      args.push(")", "-prune", "-o");
    }
    args.push("(", "-type", "d", "-o", "-type", "f", ")", "-printf", "%y\\0%P\\0");
    const result = await this.bash(shellCommand(args), options);
    if (result.exitCode !== 0) requireSuccess(result);
    const fields = result.stdout.split("\0");
    fields.pop(); // 只解析完整的 NUL 分隔记录，包括输出被截断的情况。
    const tree: FileEntry[] = [];
    const directories = new Map<string, FileEntry[]>();
    directories.set(".", tree);
    let truncated = result.truncated || fields.length / 2 > maxEntries;
    for (let index = 0; index + 1 < fields.length && index / 2 < maxEntries; index += 2) {
      const name = fields[index + 1];
      const entry: FileEntry = { name: path.posix.basename(name),
        path: path.posix.join(target.relative, name), type: fields[index] === "d" ? "directory" : "file" };
      if (entry.type === "directory") {
        entry.children = [];
        directories.set(name, entry.children);
        if (name.split("/").length > maxDepth) truncated = true;
      }
      directories.get(path.posix.dirname(name))?.push(entry);
    }
    const sort = (entries: FileEntry[]) => {
      entries.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
      for (const entry of entries) if (entry.children) sort(entry.children);
    };
    sort(tree);
    return { tree, truncated };
  }

  async search(query: string, options: BashOptions & ListOptions & { path?: string; maxResults?: number } = {}): Promise<SearchResult> {
    if (!query || query.includes("\n")) throw new Error("请提供单行搜索内容");
    const maxResults = limit(options.maxResults, 100);
    const listing = await this.list(options.path ?? ".", options);
    const files: string[] = [];
    const collect = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.children) collect(entry.children);
        else files.push(`./${entry.path}`);
      }
    };
    collect(listing.tree);
    if (!files.length) return { matches: [], truncated: listing.truncated };
    const result = await this.bash(shellCommand(["grep", "-H", "-n", "-F", "-I", "-Z", "--", query, ...files]), options);
    if (result.exitCode !== 0 && result.exitCode !== 1) requireSuccess(result);
    const matches: FileMatch[] = [];
    let offset = 0;
    let truncated = listing.truncated || result.truncated;
    while (offset < result.stdout.length) {
      const separator = result.stdout.indexOf("\0", offset);
      const end = result.stdout.indexOf("\n", separator + 1);
      if (separator < 0 || end < 0) break;
      if (matches.length === maxResults) { truncated = true; break; }
      const line = result.stdout.slice(separator + 1, end);
      const colon = line.indexOf(":");
      matches.push({ path: result.stdout.slice(offset, separator).slice(2),
        line: Number(line.slice(0, colon)), text: line.slice(colon + 1).replace(/\r$/u, "") });
      offset = end + 1;
    }
    return { matches, truncated };
  }
}
