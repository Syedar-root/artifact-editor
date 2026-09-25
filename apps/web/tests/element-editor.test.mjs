import assert from "node:assert/strict";
import test from "node:test";
import { createElementEditor } from "../src/sdk/element-editor/editor.ts";

function createStyle(initial = {}) {
  const values = new Map(
    Object.entries(initial).map(([name, value]) => [name, { value, priority: "" }]),
  );
  return {
    getPropertyValue(name) {
      return values.get(name)?.value ?? "";
    },
    getPropertyPriority(name) {
      return values.get(name)?.priority ?? "";
    },
    setProperty(name, value, priority = "") {
      values.set(name, { value: String(value), priority });
    },
    removeProperty(name) {
      const previous = values.get(name)?.value ?? "";
      values.delete(name);
      return previous;
    },
  };
}

function createElement({
  tagName,
  textContent = "",
  attributes = {},
  inlineStyle = {},
  computedStyle = {},
  width = 100,
  height = 40,
}) {
  const attributeValues = new Map(Object.entries(attributes));
  const style = createStyle(inlineStyle);
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    textContent,
    style,
    isConnected: true,
    hasAttribute(name) {
      return attributeValues.has(name);
    },
    getAttribute(name) {
      return attributeValues.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributeValues.set(name, String(value));
    },
    removeAttribute(name) {
      attributeValues.delete(name);
    },
  };
  element.ownerDocument = {
    defaultView: {
      getComputedStyle() {
        return {
          fontSize: "16px",
          fontWeight: "400",
          fontStyle: "normal",
          color: "rgb(34, 34, 34)",
          objectFit: "fill",
          aspectRatio: "auto",
          ...computedStyle,
        };
      },
    },
  };
  return { element, attributes: attributeValues, style, width, height };
}

function inspection(fixture, hint) {
  const { element, width, height } = fixture;
  return {
    element,
    selection: {
      tagName: element.tagName.toLowerCase(),
      id: "",
      classNames: [],
      hint,
    },
    boxModel: {
      rect: { left: 10, top: 20, width, height },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      rowGap: 0,
      columnGap: 0,
      gapRects: [],
    },
  };
}

test("文本元素暴露内容和排版属性，并能取消全部预览修改", () => {
  const fixture = createElement({
    tagName: "p",
    textContent: "欢迎使用",
    inlineStyle: { "font-weight": "500" },
  });
  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "p"));

  const propertyKeys = editor.getState().properties.map(({ key }) => key);
  for (const expected of [
    "content.text",
    "typography.fontFamily",
    "typography.fontSize",
    "typography.fontWeight",
    "typography.fontStyle",
    "typography.lineHeight",
    "typography.textAlign",
    "typography.color",
    "size.width",
    "layout.display",
    "spacing.paddingTop",
    "appearance.backgroundColor",
    "appearance.borderRadius",
  ]) {
    assert.equal(propertyKeys.includes(expected), true, `缺少属性 ${expected}`);
  }

  assert.deepEqual(editor.update({ property: "content.text", value: "开始构建" }), { ok: true });
  assert.deepEqual(editor.update({ property: "typography.fontSize", value: "18px" }), { ok: true });
  assert.deepEqual(editor.update({ property: "typography.fontWeight", value: 700 }), { ok: true });
  assert.equal(fixture.element.textContent, "开始构建");
  assert.equal(fixture.style.getPropertyValue("font-size"), "18px");
  assert.equal(fixture.style.getPropertyValue("font-weight"), "700");
  assert.equal(editor.getState().dirty, true);

  editor.cancel();
  assert.equal(fixture.element.textContent, "欢迎使用");
  assert.equal(fixture.style.getPropertyValue("font-size"), "");
  assert.equal(fixture.style.getPropertyValue("font-weight"), "500");
  assert.equal(editor.getState().status, "idle");
});

test("确认编辑会保留 DOM 预览并返回可序列化的前后值", () => {
  const fixture = createElement({ tagName: "button", textContent: "提交" });
  const states = [];
  const editor = createElementEditor({ onStateChange: (state) => states.push(state) });
  editor.setTarget(inspection(fixture, "button.primary"));
  editor.update({ property: "content.text", value: "立即提交" });
  editor.update({ property: "typography.fontWeight", value: 700 });

  assert.deepEqual(editor.commit(), {
    target: {
      tagName: "button",
      id: "",
      classNames: [],
      hint: "button.primary",
    },
    changes: [
      {
        property: "content.text",
        subject: { kind: "element" },
        before: "提交",
        after: "立即提交",
      },
      {
        property: "typography.fontWeight",
        subject: { kind: "element" },
        before: 400,
        after: 700,
      },
    ],
  });
  assert.equal(fixture.element.textContent, "立即提交");
  assert.equal(fixture.style.getPropertyValue("font-weight"), "700");
  assert.equal(editor.getState().status, "idle");
  assert.equal(states.at(-1).status, "idle");
});

test("图片元素暴露图片、尺寸和比例属性，并精确恢复 attribute 与 style", () => {
  const fixture = createElement({
    tagName: "img",
    attributes: { src: "/hero.png" },
    inlineStyle: { width: "50%", "object-fit": "contain" },
    computedStyle: { objectFit: "contain", aspectRatio: "16 / 9" },
    width: 640,
    height: 360,
  });
  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "img.hero"));

  const propertyKeys = editor.getState().properties.map(({ key }) => key);
  for (const expected of [
    "media.src",
    "media.alt",
    "media.objectFit",
    "size.width",
    "size.height",
    "size.aspectRatio",
    "spacing.paddingTop",
    "appearance.borderRadius",
  ]) {
    assert.equal(propertyKeys.includes(expected), true, `缺少属性 ${expected}`);
  }

  editor.update({ property: "media.src", value: "/next.png" });
  editor.update({ property: "media.alt", value: "新的封面" });
  editor.update({ property: "media.objectFit", value: "cover" });
  editor.update({ property: "size.width", value: "720px" });
  assert.equal(fixture.element.getAttribute("src"), "/next.png");
  assert.equal(fixture.element.getAttribute("alt"), "新的封面");
  assert.equal(fixture.style.getPropertyValue("object-fit"), "cover");
  assert.equal(fixture.style.getPropertyValue("width"), "720px");

  editor.cancel();
  assert.equal(fixture.element.getAttribute("src"), "/hero.png");
  assert.equal(fixture.element.hasAttribute("alt"), false);
  assert.equal(fixture.style.getPropertyValue("object-fit"), "contain");
  assert.equal(fixture.style.getPropertyValue("width"), "50%");
});

test("拒绝不支持的属性和非法值，不产生 DOM 修改", () => {
  const fixture = createElement({ tagName: "p", textContent: "正文" });
  const editor = createElementEditor();

  assert.deepEqual(editor.update({ property: "typography.fontSize", value: 20 }), {
    ok: false,
    code: "no-target",
  });

  editor.setTarget(inspection(fixture, "p"));
  assert.deepEqual(editor.update({ property: "media.src", value: "/image.png" }), {
    ok: false,
    code: "unsupported-property",
  });
  assert.deepEqual(editor.update({ property: "typography.fontSize", value: "" }), {
    ok: false,
    code: "invalid-value",
  });
  assert.equal(fixture.style.getPropertyValue("font-size"), "");
  assert.equal(editor.getState().dirty, false);
});

test("复合按钮按文本节点生成独立绑定，修改文字不会破坏图标结构", () => {
  const fixture = createElement({
    tagName: "button",
    textContent: "立即开始",
    computedStyle: { display: "inline-flex" },
  });
  const textNode = { nodeType: 3, data: "立即开始" };
  const icon = {
    nodeType: 1,
    tagName: "SVG",
    childNodes: [],
    children: [],
    getAttribute: () => null,
  };
  const label = {
    nodeType: 1,
    tagName: "SPAN",
    childNodes: [textNode],
    children: [],
    getAttribute: () => null,
  };
  fixture.element.childNodes = [icon, label];
  fixture.element.children = [icon, label];

  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "button.primary"));
  const textProperty = editor.getState().properties.find(({ key }) => key === "content.text");

  assert.equal(textProperty.id, "content.text");
  assert.deepEqual(editor.update({ property: textProperty.id, value: "马上体验" }), { ok: true });
  assert.equal(textNode.data, "马上体验");
  assert.equal(fixture.element.children[0], icon);

  const changeSet = editor.commit();
  assert.deepEqual(changeSet.changes[0].subject, { kind: "text-node", path: [1, 0] });
});

test("嵌套文本聚合为一个完整属性，编辑时保留原有 DOM 结构", () => {
  const fixture = createElement({
    tagName: "h1",
    textContent: "会爆汁的双层芝士堡",
  });
  const firstText = { nodeType: 3, data: "会爆汁的" };
  const secondText = { nodeType: 3, data: "双层芝士堡" };
  const lineBreak = {
    nodeType: 1,
    tagName: "BR",
    childNodes: [],
    children: [],
    getAttribute: () => null,
  };
  fixture.element.childNodes = [firstText, lineBreak, secondText];
  fixture.element.children = [lineBreak];

  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "h1.hero-title"));
  const textProperties = editor
    .getState()
    .properties.filter(({ key }) => key === "content.text");

  assert.equal(textProperties.length, 1);
  assert.equal(textProperties[0].id, "content.text");
  assert.equal(textProperties[0].value, "会爆汁的双层芝士堡");

  assert.deepEqual(editor.update({ property: "content.text", value: "鲜嫩多汁双层牛肉堡" }), {
    ok: true,
  });
  assert.equal(firstText.data + secondText.data, "鲜嫩多汁双层牛肉堡");
  assert.equal(fixture.element.childNodes[1], lineBreak);

  editor.cancel();
  assert.equal(firstText.data, "会爆汁的");
  assert.equal(secondText.data, "双层芝士堡");
  assert.equal(fixture.element.childNodes[1], lineBreak);
});

test("先删除再输入分段文本时，新内容仍沿用左侧文本节点的样式", () => {
  const fixture = createElement({
    tagName: "a",
    textContent: "01招牌菜单",
  });
  const numberText = { nodeType: 3, data: "01" };
  const labelText = { nodeType: 3, data: "招牌菜单" };
  const number = {
    nodeType: 1,
    tagName: "SPAN",
    childNodes: [numberText],
    children: [],
    getAttribute: () => null,
  };
  fixture.element.childNodes = [number, labelText];
  fixture.element.children = [number];

  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "a.nav-item"));

  editor.update({ property: "content.text", value: "招牌菜单" });
  assert.equal(numberText.data, "");
  assert.equal(labelText.data, "招牌菜单");

  editor.update({ property: "content.text", value: "02招牌菜单" });
  assert.equal(numberText.data, "02");
  assert.equal(labelText.data, "招牌菜单");
  assert.equal(fixture.element.childNodes[0], number);
});

test("清空全部文本再输入时，按照原分段恢复文本样式边界", () => {
  const fixture = createElement({ tagName: "a", textContent: "01招牌菜单" });
  const numberText = { nodeType: 3, data: "01" };
  const labelText = { nodeType: 3, data: "招牌菜单" };
  const number = {
    nodeType: 1,
    tagName: "SPAN",
    childNodes: [numberText],
    children: [],
    getAttribute: () => null,
  };
  fixture.element.childNodes = [number, labelText];
  fixture.element.children = [number];

  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "a.nav-item"));
  editor.update({ property: "content.text", value: "" });
  editor.update({ property: "content.text", value: "02本期特辑" });

  assert.equal(numberText.data, "02");
  assert.equal(labelText.data, "本期特辑");
  assert.equal(fixture.element.childNodes[0], number);
});

test("普通 Flex 容器也具备尺寸、布局、间距和外观属性", () => {
  const fixture = createElement({
    tagName: "div",
    computedStyle: {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "12px",
      backgroundColor: "rgb(255, 255, 255)",
      borderRadius: "12px",
    },
  });
  fixture.element.children = [{}, {}];
  const editor = createElementEditor();
  editor.setTarget(inspection(fixture, "div.card-row"));
  const keys = editor.getState().properties.map(({ key }) => key);

  assert.equal(keys.includes("content.text"), false);
  for (const expected of [
    "size.width",
    "layout.display",
    "layout.flexDirection",
    "layout.justifyContent",
    "layout.alignItems",
    "layout.gap",
    "spacing.paddingLeft",
    "appearance.backgroundColor",
    "appearance.borderRadius",
  ]) {
    assert.equal(keys.includes(expected), true, `缺少属性 ${expected}`);
  }
});

test("链接和表单元素提供各自的语义属性", () => {
  const link = createElement({
    tagName: "a",
    textContent: "查看详情",
    attributes: { href: "/details", target: "_blank" },
  });
  const linkEditor = createElementEditor();
  linkEditor.setTarget(inspection(link, "a.details"));
  const linkKeys = linkEditor.getState().properties.map(({ key }) => key);
  assert.equal(linkKeys.includes("link.href"), true);
  assert.equal(linkKeys.includes("link.target"), true);

  const checkbox = createElement({
    tagName: "input",
    attributes: { type: "checkbox", placeholder: "同意条款" },
  });
  checkbox.element.value = "yes";
  checkbox.element.checked = false;
  checkbox.element.disabled = false;
  const formEditor = createElementEditor();
  formEditor.setTarget(inspection(checkbox, "input#terms"));
  const formKeys = formEditor.getState().properties.map(({ key }) => key);
  assert.equal(formKeys.includes("form.value"), true);
  assert.equal(formKeys.includes("form.placeholder"), true);
  assert.equal(formKeys.includes("form.checked"), true);
  assert.equal(formKeys.includes("form.disabled"), true);

  assert.deepEqual(formEditor.update({ property: "form.checked", value: true }), { ok: true });
  assert.equal(checkbox.element.checked, true);
  formEditor.cancel();
  assert.equal(checkbox.element.checked, false);
});

test("切换目标和销毁 editor 都会恢复未确认修改", () => {
  const first = createElement({ tagName: "p", textContent: "第一段" });
  const second = createElement({ tagName: "p", textContent: "第二段" });
  const editor = createElementEditor();

  editor.setTarget(inspection(first, "p.first"));
  editor.update({ property: "content.text", value: "已修改" });
  editor.setTarget(inspection(second, "p.second"));
  assert.equal(first.element.textContent, "第一段");

  editor.update({ property: "content.text", value: "也修改" });
  editor.destroy();
  assert.equal(second.element.textContent, "第二段");
  assert.equal(editor.getState().status, "idle");
});
