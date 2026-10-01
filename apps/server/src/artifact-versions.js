import { randomUUID } from "node:crypto";
import { requireSuccess, runGit, shellCommand } from "@artifact-editor/sdk/server";
function messageFor(value, fallback) {
    return value?.replace(/\s+/gu, " ").trim().slice(0, 120) || fallback;
}
export class ArtifactVersions {
    execute;
    constructor(execute){
        this.execute = execute;
    }
    async git(args, allowFailure = false) {
        const result = await runGit({ bash: this.execute }, args, {
            timeoutMs: 30_000
        });
        if (!allowFailure) requireSuccess(result);
        if (result.truncated) throw new Error("Git 输出超过大小限制");
        return {
            ...result,
            stdout: result.stdout.trimEnd(),
            stderr: result.stderr.trimEnd()
        };
    }
    async list(metadata = true) {
        const { stdout } = await this.git([
            "for-each-ref",
            "--sort=-version:refname",
            metadata ? "--format=%(refname:short)%09%(*objectname)%09%(*committerdate:iso-strict)%09%(*subject)%09%(objectname)%09%(committerdate:iso-strict)%09%(subject)" : "--format=%(refname:short)%09%(*objectname)%09%09%09%(objectname)%09%09",
            "refs/tags/checkpoint/"
        ]);
        return stdout.split("\n").filter(Boolean).flatMap((line)=>{
            const [tag = "", annotatedSha, annotatedDate, annotatedMessage, sha = "", date = "", message = ""] = line.split("\t");
            const match = /^checkpoint\/v([1-9]\d*)$/u.exec(tag);
            if (!match || !Number.isSafeInteger(Number(match[1]))) return [];
            return [
                {
                    version: Number(match[1]),
                    tag,
                    commitSha: annotatedSha || sha,
                    createdAt: annotatedDate || date,
                    message: annotatedMessage || message
                }
            ];
        });
    }
    async repositoryState(metadata = true) {
        const [checkpoints, branchResult, headResult, workspaceResult, dirtyResult] = await Promise.all([
            this.list(metadata),
            this.git([
                "branch",
                "--show-current"
            ]),
            this.git([
                "rev-parse",
                "HEAD"
            ]),
            this.git([
                "rev-parse",
                "refs/heads/workspace"
            ]),
            this.git([
                "status",
                "--porcelain",
                "--untracked-files=all"
            ])
        ]);
        const branch = branchResult.stdout;
        const headSha = headResult.stdout;
        const workspaceSha = workspaceResult.stdout;
        const latestVersion = checkpoints[0]?.version ?? 0;
        return {
            branch,
            headSha,
            workspaceSha,
            snapshot: {
                checkpoints,
                state: {
                    mode: branch === "workspace" ? "latest" : branch.startsWith("edit/") ? "editing-history" : "historical-preview",
                    activeVersion: checkpoints.find((item)=>item.commitSha === headSha)?.version ?? null,
                    workspaceVersion: checkpoints.find((item)=>item.commitSha === workspaceSha)?.version ?? null,
                    latestVersion,
                    nextVersion: latestVersion + 1,
                    revision: `${branch || "detached"}:${headSha}`,
                    dirty: Boolean(dirtyResult.stdout)
                }
            }
        };
    }
    async inspect() {
        return (await this.repositoryState()).snapshot;
    }
    async status() {
        return (await this.repositoryState(false)).snapshot.state;
    }
    async initialize(options = {}) {
        const prefix = await this.git([
            "rev-parse",
            "--show-prefix"
        ], true);
        if (prefix.exitCode === 0 && prefix.stdout) throw new Error("产物目录必须拥有独立的 Git 仓库");
        if (prefix.exitCode !== 0) await this.git([
            "init",
            "-b",
            "workspace"
        ]);
        const versions = await this.list();
        if (versions.length) return this.inspect();
        const excludePath = (await this.git([
            "rev-parse",
            "--git-path",
            "info/exclude"
        ])).stdout;
        const script = String.raw`const fs = require("node:fs"), path = require("node:path");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
let text = ""; try { text = fs.readFileSync(input.path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const lines = new Set(text.split(/\r?\n/u));
const missing = input.ignore.filter(line => !lines.has(line));
if (missing.length) { fs.mkdirSync(path.dirname(input.path), { recursive: true });
fs.appendFileSync(input.path, (text && !text.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n"); }`;
        requireSuccess(await this.execute(shellCommand([
            "node",
            "-e",
            script
        ]), {
            stdin: JSON.stringify({
                path: excludePath,
                ignore: options.ignore ?? [
                    "node_modules/",
                    "dist/",
                    ".vite/"
                ]
            })
        }));
        await this.git([
            "add",
            "-A"
        ]);
        const head = await this.git([
            "rev-parse",
            "--verify",
            "HEAD"
        ], true);
        const staged = await this.git([
            "diff",
            "--cached",
            "--quiet"
        ], true);
        if (staged.exitCode !== 0 && staged.exitCode !== 1) requireSuccess(staged);
        if (head.exitCode !== 0 || staged.exitCode === 1) await this.commit(messageFor(options.message, "Initial artifact"), true);
        const branch = (await this.git([
            "branch",
            "--show-current"
        ])).stdout;
        if (branch !== "workspace") await this.git([
            "switch",
            "-c",
            "workspace"
        ]);
        await this.git([
            "-c",
            "user.name=Artifact Editor",
            "-c",
            "user.email=artifact-editor@local",
            "tag",
            "-a",
            "checkpoint/v1",
            "-m",
            "V1"
        ]);
        return this.inspect();
    }
    commit(message, allowEmpty = false) {
        return this.git([
            "-c",
            "user.name=Artifact Editor",
            "-c",
            "user.email=artifact-editor@local",
            "commit",
            ...allowEmpty ? [
                "--allow-empty"
            ] : [],
            "-m",
            message
        ]);
    }
    assertClean(state) {
        if (state.snapshot.state.dirty) throw new Error("产物仍有未保存的修改");
    }
    async tagFor(version) {
        if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("版本号无效");
        const tag = `checkpoint/v${version}`;
        const exists = await this.git([
            "rev-parse",
            "--verify",
            `refs/tags/${tag}^{commit}`
        ], true);
        if (exists.exitCode !== 0) throw new Error(`找不到 V${version}`);
        return tag;
    }
    async checkout(version) {
        const before = await this.repositoryState();
        this.assertClean(before);
        if (before.branch.startsWith("edit/")) throw new Error("请先结束当前历史版本编辑");
        await this.git([
            "switch",
            "--detach",
            await this.tagFor(version)
        ]);
        return this.inspect();
    }
    async beginEdit(version) {
        const before = await this.repositoryState();
        this.assertClean(before);
        if (before.branch.startsWith("edit/")) throw new Error("已经在编辑一个历史版本");
        await this.git([
            "switch",
            "-c",
            `edit/${randomUUID()}`,
            await this.tagFor(version)
        ]);
        return this.inspect();
    }
    async resume() {
        const before = await this.repositoryState();
        this.assertClean(before);
        await this.git([
            "switch",
            "workspace"
        ]);
        if (before.branch.startsWith("edit/")) await this.git([
            "branch",
            "-D",
            before.branch
        ]);
        return this.inspect();
    }
    async capture(options = {}, clean = true) {
        const before = await this.repositoryState();
        if (before.snapshot.state.mode === "historical-preview") throw new Error("历史版本是只读的，请先选择“基于此版本编辑”");
        if (options.expectedRevision && options.expectedRevision !== before.snapshot.state.revision) {
            throw new Error("产物版本已经变化，请刷新后重试");
        }
        if (clean) this.assertClean(before);
        return before;
    }
    async restore(before, discardChanges) {
        await this.git([
            "update-ref",
            "refs/heads/workspace",
            before.workspaceSha
        ]);
        await this.git([
            "update-ref",
            `refs/heads/${before.branch}`,
            before.headSha
        ]);
        await this.git([
            "symbolic-ref",
            "HEAD",
            `refs/heads/${before.branch}`
        ]);
        await this.git([
            "reset",
            discardChanges ? "--hard" : "--mixed",
            before.headSha
        ]);
        if (discardChanges) await this.git([
            "clean",
            "-fd"
        ]);
    }
    async checkpoint(options = {}) {
        const before = await this.capture(options, false);
        if (!before.snapshot.state.dirty && before.snapshot.checkpoints.some(item => item.commitSha === before.headSha)) return null;
        const version = before.snapshot.state.nextVersion;
        const tag = `checkpoint/v${version}`;
        const message = messageFor(options.message, `Checkpoint V${version}`);
        let commitSha = "";
        try {
            if (before.snapshot.state.dirty) {
                await this.git(["add", "-A"]);
                await this.commit(message);
            }
            commitSha = (await this.git([
                "rev-parse",
                "HEAD"
            ])).stdout;
            await this.git([
                "-c",
                "user.name=Artifact Editor",
                "-c",
                "user.email=artifact-editor@local",
                "tag",
                "-a",
                tag,
                "-m",
                `V${version}`
            ]);
            if (before.branch.startsWith("edit/")) {
                await this.git([
                    "update-ref",
                    "refs/heads/workspace",
                    commitSha
                ]);
                await this.git([
                    "switch",
                    "workspace"
                ]);
                await this.git([
                    "branch",
                    "-D",
                    before.branch
                ]);
            }
        } catch (error) {
            try {
                const tagResult = await this.git([
                    "rev-parse",
                    "--verify",
                    `refs/tags/${tag}`
                ], true);
                if (tagResult.exitCode === 0) await this.git([
                    "tag",
                    "-d",
                    tag
                ]);
                await this.restore(before, false);
            } catch (recoveryError) {
                throw new AggregateError([
                    error,
                    recoveryError
                ], "保存版本失败，Git 状态恢复也失败");
            }
            throw error;
        }
        return {
            version,
            tag,
            commitSha,
            message,
            createdAt: new Date().toISOString()
        };
    }
    async diff(from, to) {
        return (await this.git([
            "diff",
            await this.tagFor(from),
            to === undefined ? "HEAD" : await this.tagFor(to),
            "--"
        ])).stdout;
    }
}
