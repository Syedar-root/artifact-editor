import { runGit } from "./git.ts";
import { requireSuccess, type Sandbox } from "./sandbox.ts";

export interface GitVersion {
  version: string;
  commitSha: string;
  createdAt: string;
  message: string;
}

/** 目录内的 Git 版本操作；版本名、调用时机和业务流程由调用方决定。 */
export class GitVersions {
  constructor(
    private readonly sandbox: Pick<Sandbox, "bash">,
    private readonly cwd: string,
  ) {}

  private async git(args: readonly string[]) {
    return requireSuccess(await runGit(this.sandbox, args, { cwd: this.cwd }));
  }

  async initialize(branch?: string): Promise<void> {
    await this.git([
      "init",
      ...(branch === undefined ? [] : [`--initial-branch=${branch}`]),
    ]);
  }

  async list(): Promise<GitVersion[]> {
    const result = await this.git([
      "for-each-ref",
      "--sort=-version:refname",
      "--format=%(refname:strip=2)%00%(*objectname)%00%(objectname)%00%(creatordate:iso-strict)%00%(subject)",
      "refs/tags",
    ]);
    return result.stdout
      .trimEnd()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [version, annotatedSha, sha, createdAt, message] =
          line.split("\0");
        return { version, commitSha: annotatedSha || sha, createdAt, message };
      });
  }

  async checkout(version: string): Promise<void> {
    await this.git(["switch", "--detach", `refs/tags/${version}`]);
  }

  async commit(message: string): Promise<string> {
    if (!message.trim() || message.includes("\0"))
      throw new TypeError("提交说明无效");
    await this.git(["add", "-A"]);
    await this.git(["commit", "-m", message]);
    return (await this.git(["rev-parse", "HEAD"])).stdout.trim();
  }

  async publish(version: string, message = version): Promise<string> {
    if (!version || version.startsWith("-")) throw new TypeError("版本名无效");
    if (!message.trim() || message.includes("\0"))
      throw new TypeError("发布说明无效");
    await this.git(["check-ref-format", `refs/tags/${version}`]);
    const existing = await runGit(
      this.sandbox,
      ["show-ref", "--verify", "--quiet", `refs/tags/${version}`],
      { cwd: this.cwd },
    );
    if (existing.exitCode === 0) throw new Error(`版本已存在：${version}`);
    if (existing.exitCode !== 1) requireSuccess(existing);
    const commitSha = (
      await this.git(["rev-parse", "--verify", "HEAD^{commit}"])
    ).stdout.trim();
    await this.git(["tag", "-a", version, "-m", message, commitSha]);
    return commitSha;
  }
}
