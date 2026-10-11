export interface BuildCheckpoint {
  version: number;
  commitSha: string;
}

export interface ArtifactBuild extends BuildCheckpoint {
  artifactId: string;
  status: "queued" | "building" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
  previewUrl?: string;
  runtime?: string;
  error?: string;
}
