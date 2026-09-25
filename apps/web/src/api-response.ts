export async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error("Agent 服务连接中断，请重新发送这条消息");
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("Agent 服务返回了无法识别的数据，请重新发送这条消息");
  }
}
