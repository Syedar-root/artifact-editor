import path from "node:path";
import { requireSuccess } from "@artifact-editor/sdk/server";
import { ArtifactVersions } from "./artifact-versions.js";
const queues = new WeakMap();
function serializer(sandbox, root) {
    let pending = queues.get(sandbox);
    if (!pending) {
        pending = new Map();
        queues.set(sandbox, pending);
    }
    const entries = pending;
    return async (operation)=>{
        const previous = entries.get(root) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve)=>{
            release = resolve;
        });
        const tail = previous.then(()=>current);
        entries.set(root, tail);
        await previous;
        try {
            return await operation();
        } finally{
            release();
            if (entries.get(root) === tail) entries.delete(root);
        }
    };
}
function relativePath(value) {
    if (!value || value.includes("\0") || value.includes("\\") || /^[A-Za-z]:/u.test(value) || path.posix.isAbsolute(value)) {
        throw new TypeError("请使用工作区内的相对路径");
    }
    const normalized = path.posix.normalize(value);
    if (normalized === ".." || normalized.startsWith("../")) throw new Error("文件路径超出工作区目录");
    return normalized;
}
export function createArtifactWorkspace({ sandbox, root, buildCommand }) {
    if (!path.posix.isAbsolute(root) || root.includes("\0") || root.includes("\\")) throw new TypeError("工作区必须使用沙箱内的绝对 POSIX 路径");
    root = path.posix.normalize(root).replace(/\/$/u, "") || "/";
    const withLock = serializer(sandbox, root);
    const execute = (command, options = {})=>sandbox.bash(command, {
            ...options,
            cwd: root
        });
    const git = new ArtifactVersions(execute);
    const files = {
        read: (file, options)=>sandbox.read(relativePath(file), {
                ...options,
                cwd: root
            }),
        write: (file, content, options)=>sandbox.write(relativePath(file), content, {
                ...options,
                cwd: root
            }),
        edit: (file, oldText, newText, options)=>sandbox.edit(relativePath(file), oldText, newText, {
                ...options,
                cwd: root
            }),
        async list(directory = ".", options) {
            const result = await sandbox.list(relativePath(directory), {
                ignore: ["node_modules", ".git", "dist", ".vite", ".artifact"],
                ...options,
                cwd: root,
            });
            const firstFile = (entries) => {
                for (const entry of entries) {
                    if (entry.type === "file") return entry.path;
                    const nested = firstFile(entry.children ?? []);
                    if (nested) return nested;
                }
                return "";
            };
            return { ...result, defaultFile: result.tree.find(entry => entry.path === "index.html")?.path
                ?? firstFile(result.tree) };
        },
        search: (query, options = {})=>sandbox.search(query, {
                ...options,
                path: relativePath(options.path ?? "."),
                cwd: root
            })
    };
    const execution = {
        sandbox,
        root,
        execute,
        files,
        async build (options) {
            if (!buildCommand) throw new Error("请为工作区配置 buildCommand");
            return requireSuccess(await execute(buildCommand, options));
        }
    };
    return {
        ...execution,
        execute: (command, options)=>withLock(()=>execute(command, options)),
        build: (options)=>withLock(()=>execution.build(options)),
        files: {
            read: (file, options)=>withLock(()=>files.read(file, options)),
            write: (file, content, options)=>withLock(()=>files.write(file, content, options)),
            edit: (file, oldText, newText, options)=>withLock(()=>files.edit(file, oldText, newText, options)),
            list: (directory, options)=>withLock(()=>files.list(directory, options)),
            search: (query, options)=>withLock(()=>files.search(query, options))
        },
        versions: {
            initialize: (options)=>withLock(()=>git.initialize(options)),
            list: ()=>withLock(()=>git.list()),
            status: ()=>withLock(()=>git.status()),
            inspect: ()=>withLock(()=>git.inspect()),
            checkout: (version)=>withLock(()=>git.checkout(version)),
            beginEdit: (version)=>withLock(()=>git.beginEdit(version)),
            resume: ()=>withLock(()=>git.resume()),
            checkpoint: (options)=>withLock(()=>git.checkpoint(options)),
            diff: (from, to)=>withLock(()=>git.diff(from, to))
        },
        edit: (options, operation)=>withLock(async ()=>{
                const before = await git.capture(options);
                let value;
                let checkpoint;
                try {
                    value = await operation(execution);
                    await options.verify?.(execution);
                    checkpoint = await git.checkpoint({
                        message: options.message
                    });
                } catch (error) {
                    if (options.onError === "rollback") {
                        try {
                            await git.restore(before, true);
                        } catch (recoveryError) {
                            throw new AggregateError([
                                error,
                                recoveryError
                            ], "编辑失败，文件恢复也失败");
                        }
                    }
                    throw error;
                }
                const snapshot = await git.inspect();
                return {
                    value,
                    changed: checkpoint !== null,
                    checkpoint,
                    ...snapshot
                };
            })
    };
}
