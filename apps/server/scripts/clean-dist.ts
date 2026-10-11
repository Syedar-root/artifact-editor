import { rmSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(serverRoot, "dist");
if (relative(serverRoot, output) !== "dist")
  throw new Error("编译输出目录超出 Server 路径");
rmSync(output, { recursive: true, force: true });
