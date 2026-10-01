import { requireSuccess, shellCommand } from "@artifact-editor/sdk/server";
import { DockerSandbox } from "@artifact-editor/sdk/server/docker";
import { createArtifactWorkspace } from "./artifact-workspace.js";

// The demo host chooses one user's existing container. SDK has no user or persistence model.
export const PI_CONTAINER_ID = process.env.ARTIFACT_SANDBOX_CONTAINER
  || "3d676529c2ce5d5967767a8b3fcb32b2b5faac60a86ec7aa13fce04400c308b4";
export const SANDBOX_WORKSPACE_ROOT = "/workspace";
export const sandbox = new DockerSandbox({ containerId: PI_CONTAINER_ID });
const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/u;

export function isValidArtifactId(value) {
  return typeof value === "string" && ARTIFACT_ID_PATTERN.test(value);
}

export function artifactRoot(artifactId) {
  if (!isValidArtifactId(artifactId)) throw new Error("无效的 artifact ID");
  return `${SANDBOX_WORKSPACE_ROOT}/${artifactId}`;
}

export function workspaceForArtifact(artifactId) {
  return createArtifactWorkspace({ sandbox, root: artifactRoot(artifactId), buildCommand: "npm run build" });
}

export function initializeArtifactWorkspace(artifactId) {
  return workspaceForArtifact(artifactId).versions.initialize({
    message: "Create artifact", ignore: ["node_modules/", "dist/", ".vite/", ".artifact/"],
  });
}

export async function runSandboxNode(script, args = [], options = {}) {
  return requireSuccess(await sandbox.bash(shellCommand(["node", "-e", script, ...args]), options)).stdout;
}
