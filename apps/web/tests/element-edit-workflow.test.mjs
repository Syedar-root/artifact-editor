import assert from "node:assert/strict";
import test from "node:test";

import {
  editingQueueItem,
  editingTargetForSelection,
  mergeEditedElement,
} from "../src/element-edit-workflow.ts";

function queuedElement(overrides = {}) {
  return {
    key: 7,
    tagName: "button",
    id: "save",
    classNames: ["primary"],
    hint: "button#save.primary",
    domHint: {
      path: "button#save.primary",
      ancestors: [],
      attributes: {},
    },
    comment: "按钮不够突出",
    changes: [{
      property: "typography.fontSize",
      subject: { kind: "element" },
      before: "14px",
      after: "16px",
    }],
    ...overrides,
  };
}

test("发送列表项可以成为唯一编辑目标，并带回已有评论", () => {
  const item = queuedElement();
  const target = editingQueueItem(item);

  assert.deepEqual(target, {
    kind: "queue-item",
    key: 7,
    element: item,
  });
  assert.equal(target.element.comment, "按钮不够突出");
});

test("在预览中再次激活同一元素时恢复发送列表里的编辑草稿", () => {
  const domElement = {};
  const item = queuedElement({ element: domElement });
  const target = editingTargetForSelection({
    element: domElement,
    selection: item,
    boxModel: {},
  }, [item]);

  assert.equal(target.kind, "queue-item");
  assert.equal(target.key, item.key);
  assert.equal(target.element.comment, "按钮不够突出");
});

test("再次保存发送列表项时原位更新，不追加重复项", () => {
  const original = queuedElement();
  const next = mergeEditedElement(
    [original],
    { kind: "queue-item", key: original.key, element: original },
    queuedElement({
      key: 99,
      comment: "改成更醒目的主按钮",
      changes: [{
        property: "typography.fontSize",
        subject: { kind: "element" },
        before: "16px",
        after: "18px",
      }],
    }),
  );

  assert.equal(next.length, 1);
  assert.equal(next[0].key, original.key);
  assert.equal(next[0].comment, "改成更醒目的主按钮");
  assert.deepEqual(next[0].changes, [{
    property: "typography.fontSize",
    subject: { kind: "element" },
    before: "14px",
    after: "18px",
  }]);
});

test("同一源码位置重复渲染的不同元素保留各自草稿", () => {
  const source = { file: "src/List.tsx", line: 12, column: 5 };
  const item = queuedElement({ element: { isConnected: true }, source });
  const target = editingTargetForSelection({
    element: { isConnected: true },
    selection: { ...item, source },
    boxModel: {},
  }, [item]);

  assert.equal(target.kind, "preview-selection");
});

test("新的预览选择仍会追加为新的发送列表项", () => {
  const original = queuedElement();
  const added = queuedElement({ key: 8, id: "cancel", hint: "button#cancel" });
  const next = mergeEditedElement(
    [original],
    { kind: "preview-selection" },
    added,
  );

  assert.deepEqual(next, [original, added]);
});
