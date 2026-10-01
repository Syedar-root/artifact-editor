import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const sdkRoot = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(sdkRoot, "dist");
if (!output.startsWith(path.resolve(sdkRoot) + path.sep) || path.basename(output) !== "dist") {
  throw new Error("SDK 构建输出目录无效");
}
// Remove outputs of renamed/deleted modules so they cannot leak into a published package.
rmSync(output, { recursive: true, force: true });
const packageFile = fileURLToPath(import.meta.resolve("typescript/package.json"));
const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
const compiler = path.resolve(path.dirname(packageFile), metadata.bin.tsc);
const result = spawnSync(process.execPath, [compiler, "-p", path.join(sdkRoot, "tsconfig.json")], {
  stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
