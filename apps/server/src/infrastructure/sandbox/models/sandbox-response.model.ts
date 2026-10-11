export class SandboxOperationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** AIO 的 HTTP 成功与操作成功是两层状态。 */
export class SandboxResponse {
  static data<T = unknown>(response: {
    ok: boolean;
    body?: unknown;
    error?: unknown;
  }): T {
    if (!response.ok)
      throw new SandboxOperationError(
        `沙箱 HTTP 请求失败：${JSON.stringify(response.error)}`,
      );
    const body = response.body as {
      success?: boolean;
      message?: string;
      data?: T & { error_type?: string; message?: string };
    };
    if (body.success !== true)
      throw new SandboxOperationError(
        body.data?.message ?? body.message ?? "沙箱请求失败",
        body.data?.error_type,
      );
    return body.data as T;
  }
}
