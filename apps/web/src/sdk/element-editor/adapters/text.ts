import {
  elementTextBinding,
  groupedTextBinding,
  styleBinding,
  textNodeBinding,
} from "../binding.ts";
import type { EditContext, PropertyAdapter, PropertyBinding } from "../binding.ts";

const TEXT_EXCLUDED_TAGS = new Set([
  "audio",
  "canvas",
  "iframe",
  "img",
  "input",
  "link",
  "meta",
  "noscript",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

const TEXT_CONTAINER_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "button",
  "code",
  "em",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "i",
  "label",
  "legend",
  "li",
  "option",
  "p",
  "pre",
  "small",
  "span",
  "strong",
  "summary",
  "td",
  "th",
  "u",
]);

interface TextSlot {
  node: Text;
  path: number[];
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}

function shouldSkipElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return TEXT_EXCLUDED_TAGS.has(tagName) || element.getAttribute("aria-hidden") === "true";
}

function collectTextSlots(root: Element): TextSlot[] {
  const childNodes = root.childNodes;
  if (!childNodes || typeof childNodes.length !== "number") return [];
  const slots: TextSlot[] = [];

  function visit(node: Node, path: number[]) {
    if (isTextNode(node)) {
      if (node.data.trim()) slots.push({ node, path });
      return;
    }
    if (!isElementNode(node) || shouldSkipElement(node)) return;
    Array.from(node.childNodes).forEach((child, index) => visit(child, [...path, index]));
  }

  Array.from(childNodes).forEach((child, index) => visit(child, [index]));
  return slots;
}

function hasVisibleText(context: EditContext, slots: TextSlot[]): boolean {
  if (TEXT_EXCLUDED_TAGS.has(context.element.tagName.toLowerCase())) return false;
  return slots.length > 0 || !!context.element.textContent?.trim();
}

export const textAdapter: PropertyAdapter = {
  id: "text",
  collect(context) {
    const tagName = context.element.tagName.toLowerCase();
    if (TEXT_EXCLUDED_TAGS.has(tagName)) return [];
    if (context.element.children.length > 0 && !TEXT_CONTAINER_TAGS.has(tagName)) return [];
    const slots = collectTextSlots(context.element);
    if (slots.length === 1) {
      const [{ node, path }] = slots;
      return [textNodeBinding(node, path, "content.text")];
    }
    if (slots.length > 1) return [groupedTextBinding(context, slots)];
    if (context.element.children.length === 0 && context.element.textContent?.trim()) {
      return [elementTextBinding(context)];
    }
    return [];
  },
};

export const typographyAdapter: PropertyAdapter = {
  id: "typography",
  collect(context) {
    const slots = collectTextSlots(context.element);
    if (!hasVisibleText(context, slots)) return [];
    const bindings: Array<PropertyBinding | null> = [
      styleBinding(context, "typography.fontFamily", "font-family", "fontFamily", "sans-serif"),
      styleBinding(context, "typography.fontSize", "font-size", "fontSize", "16px"),
      styleBinding(context, "typography.fontWeight", "font-weight", "fontWeight", "400", {
        value: (() => {
          const raw = context.computedStyle?.fontWeight || "400";
          if (raw === "normal") return 400;
          if (raw === "bold") return 700;
          const parsed = Number.parseInt(raw, 10);
          return Number.isFinite(parsed) ? parsed : 400;
        })(),
      }),
      styleBinding(context, "typography.fontStyle", "font-style", "fontStyle", "normal"),
      styleBinding(context, "typography.lineHeight", "line-height", "lineHeight", "normal"),
      styleBinding(context, "typography.textAlign", "text-align", "textAlign", "start"),
      styleBinding(context, "typography.color", "color", "color", "currentColor"),
    ];
    return bindings.filter((binding): binding is PropertyBinding => !!binding);
  },
};
