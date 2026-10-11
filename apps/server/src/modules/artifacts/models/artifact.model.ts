export type TechnologyStack = "html" | "react" | "vue";

export interface Artifact {
  id: string;
  name: string;
  status: "ready";
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
  requestedStack: TechnologyStack;
  detectedStack: TechnologyStack;
  stackChanged: boolean;
  locatorMode: "code-inspector" | "runtime-hint";
}

export class ArtifactModel {
  private static readonly idPattern =
    /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/u;
  static isValidId(value: unknown): value is string {
    return typeof value === "string" && this.idPattern.test(value);
  }
}

export type LocatorMode = "code-inspector" | "runtime-hint";
export interface ArtifactMetadata {
  id: string;
  name: string;
  previewPort: number;
  createdAt: string;
  requestedStack: TechnologyStack;
  detectedStack: TechnologyStack;
  locatorMode: LocatorMode;
}
