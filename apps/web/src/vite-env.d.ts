/// <reference types="vite/client" />

interface ModelContextTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  execute(input: { message?: unknown } | null | undefined): Promise<{
    status: string;
    reply: string;
  }>;
}

interface Document {
  modelContext?: {
    registerTool(tool: ModelContextTool, options: { signal: AbortSignal }): unknown;
  };
}
