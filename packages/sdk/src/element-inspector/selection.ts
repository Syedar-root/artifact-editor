import type { ElementSelection } from "./types.ts";

const MAX_CLASS_NAMES = 3;
const MAX_ANCESTOR_DEPTH = 5;
const MAX_ATTRIBUTES = 8;
const MAX_TEXT_LENGTH = 120;
const MAX_OUTER_HTML_LENGTH = 600;

function classNamesOf(element: Element): string[] {
  return Array.from(element.classList || []).slice(0, MAX_CLASS_NAMES);
}

function describeNode(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id;
  const classNames = classNamesOf(element);
  return `${tagName}${id ? `#${id}` : ""}${classNames
    .map((className) => `.${className}`)
    .join("")}`;
}

function buildAncestorPath(element: Element): string[] {
  const ancestors: string[] = [];
  let current: Element | null = element;

  while (current && ancestors.length < MAX_ANCESTOR_DEPTH) {
    ancestors.unshift(describeNode(current));
    if (
      current !== element
      && (current.id || current.tagName.toLowerCase() === "body")
    ) break;
    current = current.parentElement;
  }

  return ancestors;
}

function collectAttributes(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  const attributes = Array.from(element.attributes || []);
  for (const attribute of attributes) {
    if (Object.keys(result).length >= MAX_ATTRIBUTES) break;
    if (
      attribute.name === "class"
      || attribute.name === "id"
      || attribute.name === "style"
      || attribute.name.startsWith("data-insp-")
      || attribute.name === "data-artifact-source"
    ) continue;
    result[attribute.name] = attribute.value.slice(0, 160);
  }
  return result;
}

function compactText(value: string | null | undefined, maxLength: number): string {
  const normalized = (value || "").replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function parseInspectorSource(value: string): ElementSelection["source"] {
  const match = value.match(/^(.*):(\d+):(\d+):[^:]*$/u);
  if (!match) return undefined;
  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

export function describeElement(element: Element): ElementSelection {
  const tagName = element.tagName.toLowerCase();
  const id = element.id;
  const classNames = classNamesOf(element);
  const ancestors = buildAncestorPath(element);
  const path = ancestors.join(" > ");
  const sourceId = element.getAttribute?.("data-artifact-source") || "";
  const source = parseInspectorSource(element.getAttribute?.("data-insp-path") || "");
  const text = compactText(element.textContent, MAX_TEXT_LENGTH);
  const outerHTML = compactText(element.outerHTML, MAX_OUTER_HTML_LENGTH);

  return {
    tagName,
    id,
    classNames,
    hint: path,
    domHint: {
      path,
      ancestors: ancestors.slice(0, -1),
      attributes: collectAttributes(element),
      ...(text ? { text } : {}),
      ...(outerHTML ? { outerHTML } : {}),
    },
    ...(sourceId ? { sourceId } : {}),
    ...(source ? { source } : {}),
  };
}
