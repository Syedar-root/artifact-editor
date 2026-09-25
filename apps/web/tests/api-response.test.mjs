import assert from "node:assert/strict";
import test from "node:test";
import { readJsonResponse } from "../src/api-response.ts";

test("聊天接口空响应会转成可理解的连接中断提示", async () => {
  const response = new Response("", { status: 502 });

  await assert.rejects(
    readJsonResponse(response),
    /Agent 服务连接中断，请重新发送这条消息/u,
  );
});

test("聊天接口返回损坏 JSON 时不会暴露浏览器解析错误", async () => {
  const response = new Response('{"reply":', {
    status: 502,
    headers: { "content-type": "application/json" },
  });

  await assert.rejects(
    readJsonResponse(response),
    /Agent 服务返回了无法识别的数据，请重新发送这条消息/u,
  );
});

test("完整 JSON 响应保持原值", async () => {
  const payload = await readJsonResponse(
    new Response('{"reply":"OK"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.deepEqual(payload, { reply: "OK" });
});
