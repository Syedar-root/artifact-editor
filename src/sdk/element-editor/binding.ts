import type { ElementInspection } from "../element-inspector/types.ts";
import { createProperty, propertyOrder } from "./property-catalog.ts";
import type {
  ElementEditProperty,
  ElementEditPropertyKey,
  ElementEditPropertyValue,
  ElementEditSubject,
} from "./types.ts";

export interface EditContext {
  inspection: ElementInspection;
  element: Element;
  computedStyle: CSSStyleDeclaration | null;
}

export interface PropertyBinding {
  property: ElementEditProperty;
  order: number;
  slots: string[];
  subject: ElementEditSubject;
  initialValue: ElementEditPropertyValue;
  normalize(value: ElementEditPropertyValue): ElementEditPropertyValue | null;
  apply(value: ElementEditPropertyValue): void;
  restore(): void;
}

export interface PropertyAdapter {
  id: string;
  collect(context: EditContext): PropertyBinding[];
}

export function elementStyle(element: Element): CSSStyleDeclaration | null {
  const candidate = (element as Element & { style?: CSSStyleDeclaration }).style;
  return candidate && typeof candidate.setProperty === "function" ? candidate : null;
}

export function computedValue(
  context: EditContext,
  cssProperty: string,
  camelProperty: keyof CSSStyleDeclaration,
  fallback: string,
): string {
  const style = context.computedStyle;
  if (!style) return fallback;
  const byName = typeof style.getPropertyValue === "function"
    ? style.getPropertyValue(cssProperty)
    : "";
  const byCamel = style[camelProperty];
  return byName || (typeof byCamel === "string" ? byCamel : "") || fallback;
}

function safeUrl(value: string): boolean {
  return !/^\s*javascript:/iu.test(value);
}

function normalizeBySchema(
  property: ElementEditProperty,
  value: ElementEditPropertyValue,
): ElementEditPropertyValue | null {
  const { schema } = property;
  if (schema.kind === "boolean") return typeof value === "boolean" ? value : null;
  if (schema.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (schema.min !== undefined && value < schema.min) return null;
    if (schema.max !== undefined && value > schema.max) return null;
    return value;
  }
  if (schema.kind === "choice") return schema.options.includes(value as string | number) ? value : null;
  if (typeof value !== "string") return null;
  if (!value && !("allowEmpty" in schema && schema.allowEmpty)) return null;
  if (schema.kind === "url" && !safeUrl(value)) return null;
  return value;
}

function supportsCss(element: Element, cssProperty: string, value: string): boolean {
  const view = element.ownerDocument.defaultView;
  const css = view && "CSS" in view
    ? (view as Window & { CSS?: { supports(property: string, value: string): boolean } }).CSS
    : undefined;
  return css?.supports ? css.supports(cssProperty, value) : value.trim().length > 0;
}

export function styleBinding(
  context: EditContext,
  key: ElementEditPropertyKey,
  cssProperty: string,
  camelProperty: keyof CSSStyleDeclaration,
  fallback: string,
  options: {
    id?: string;
    value?: ElementEditPropertyValue;
    serialize?(value: ElementEditPropertyValue): string;
  } = {},
): PropertyBinding | null {
  const style = elementStyle(context.element);
  if (!style) return null;
  const originalValue = style.getPropertyValue(cssProperty);
  const originalPriority = style.getPropertyPriority(cssProperty);
  const initialValue = options.value ?? computedValue(context, cssProperty, camelProperty, fallback);
  const property = createProperty(key, initialValue, options.id);
  const serialize = options.serialize ?? String;

  return {
    property,
    order: propertyOrder(key),
    slots: [`style:${cssProperty}`],
    subject: { kind: "element" },
    initialValue,
    normalize(value) {
      const normalized = normalizeBySchema(property, value);
      if (normalized === null) return null;
      const serialized = serialize(normalized);
      return supportsCss(context.element, cssProperty, serialized) ? normalized : null;
    },
    apply(value) {
      style.setProperty(cssProperty, serialize(value));
    },
    restore() {
      if (originalValue) style.setProperty(cssProperty, originalValue, originalPriority);
      else style.removeProperty(cssProperty);
    },
  };
}

export function attributeBinding(
  context: EditContext,
  key: ElementEditPropertyKey,
  attribute: string,
  options: { id?: string; fallback?: string } = {},
): PropertyBinding {
  const hadAttribute = context.element.hasAttribute(attribute);
  const originalValue = context.element.getAttribute(attribute);
  const initialValue = originalValue ?? options.fallback ?? "";
  const property = createProperty(key, initialValue, options.id);

  return {
    property,
    order: propertyOrder(key),
    slots: [`attribute:${attribute}`],
    subject: { kind: "element" },
    initialValue,
    normalize(value) {
      return normalizeBySchema(property, value);
    },
    apply(value) {
      context.element.setAttribute(attribute, String(value));
    },
    restore() {
      if (hadAttribute) context.element.setAttribute(attribute, originalValue ?? "");
      else context.element.removeAttribute(attribute);
    },
  };
}

export function domPropertyBinding(
  context: EditContext,
  key: ElementEditPropertyKey,
  propertyName: string,
  initialValue: ElementEditPropertyValue,
): PropertyBinding {
  const element = context.element as Element & Record<string, unknown>;
  const property = createProperty(key, initialValue);

  return {
    property,
    order: propertyOrder(key),
    slots: [`property:${propertyName}`],
    subject: { kind: "element" },
    initialValue,
    normalize(value) {
      return normalizeBySchema(property, value);
    },
    apply(value) {
      element[propertyName] = value;
    },
    restore() {
      element[propertyName] = initialValue;
    },
  };
}

export function textNodeBinding(
  node: Text,
  path: number[],
  id: string,
): PropertyBinding {
  const initialValue = node.data;
  const property = createProperty("content.text", initialValue, id);
  return {
    property,
    order: propertyOrder("content.text"),
    slots: [`text:${path.join(".")}`],
    subject: { kind: "text-node", path: [...path] },
    initialValue,
    normalize(value) {
      return normalizeBySchema(property, value);
    },
    apply(value) {
      node.data = String(value);
    },
    restore() {
      node.data = initialValue;
    },
  };
}

interface GroupedTextSlot {
  node: Text;
  path: number[];
}

function textCharacters(value: string): string[] {
  return Array.from(value);
}

function splitUsingReferenceParts(referenceParts: string[], next: string[]): string[] {
  const referenceLengths = referenceParts.map((part) => textCharacters(part).length);
  const referenceTotal = referenceLengths.reduce((sum, length) => sum + length, 0);
  if (referenceTotal === 0) return referenceParts.map((_, index) => index === 0 ? next.join("") : "");

  const parts: string[] = [];
  let referenceBoundary = 0;
  let start = 0;
  for (const length of referenceLengths.slice(0, -1)) {
    referenceBoundary += length;
    const end = Math.max(
      start,
      Math.min(next.length, Math.round((referenceBoundary / referenceTotal) * next.length)),
    );
    parts.push(next.slice(start, end).join(""));
    start = end;
  }
  parts.push(next.slice(start).join(""));
  return parts;
}

function remapTextBoundaries(
  currentParts: string[],
  nextValue: string,
  referenceParts: string[],
): string[] {
  if (currentParts.length <= 1) return [nextValue];

  const current = textCharacters(currentParts.join(""));
  const next = textCharacters(nextValue);
  if (current.length === 0 && next.length > 0) {
    return splitUsingReferenceParts(referenceParts, next);
  }
  let prefixLength = 0;
  while (
    prefixLength < current.length
    && prefixLength < next.length
    && current[prefixLength] === next[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < current.length - prefixLength
    && suffixLength < next.length - prefixLength
    && current[current.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const currentChangeEnd = current.length - suffixLength;
  const nextChangeEnd = next.length - suffixLength;
  const currentChangeLength = currentChangeEnd - prefixLength;
  const nextChangeLength = nextChangeEnd - prefixLength;
  const boundaries: number[] = [];
  let currentBoundary = 0;

  for (const part of currentParts.slice(0, -1)) {
    currentBoundary += textCharacters(part).length;
    if (
      currentChangeLength === 0
      && nextChangeLength > 0
      && currentBoundary === prefixLength
    ) {
      // A plain input does not expose caret affinity. Prefer the left text run so
      // deleting and retyping a styled prefix keeps the replacement in that run.
      boundaries.push(nextChangeEnd);
    } else if (currentBoundary <= prefixLength) {
      boundaries.push(currentBoundary);
    } else if (currentBoundary >= currentChangeEnd) {
      boundaries.push(currentBoundary + next.length - current.length);
    } else {
      const progress = currentChangeLength === 0
        ? 0
        : (currentBoundary - prefixLength) / currentChangeLength;
      boundaries.push(prefixLength + Math.round(progress * nextChangeLength));
    }
  }

  const parts: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    const end = Math.max(start, Math.min(next.length, boundary));
    parts.push(next.slice(start, end).join(""));
    start = end;
  }
  parts.push(next.slice(start).join(""));
  return parts;
}

export function groupedTextBinding(
  context: EditContext,
  textSlots: GroupedTextSlot[],
): PropertyBinding {
  const initialParts = textSlots.map(({ node }) => node.data);
  const editableText = initialParts.join("");
  const elementText = context.element.textContent ?? "";
  const initialValue = elementText === editableText ? elementText : editableText;
  const property = createProperty("content.text", initialValue);

  return {
    property,
    order: propertyOrder("content.text"),
    slots: textSlots.map(({ path }) => `text:${path.join(".")}`),
    subject: { kind: "element" },
    initialValue,
    normalize(value) {
      return normalizeBySchema(property, value);
    },
    apply(value) {
      const nextParts = remapTextBoundaries(
        textSlots.map(({ node }) => node.data),
        String(value),
        initialParts,
      );
      textSlots.forEach(({ node }, index) => {
        node.data = nextParts[index] ?? "";
      });
    },
    restore() {
      textSlots.forEach(({ node }, index) => {
        node.data = initialParts[index];
      });
    },
  };
}

export function elementTextBinding(context: EditContext): PropertyBinding {
  const initialValue = context.element.textContent ?? "";
  const property = createProperty("content.text", initialValue);
  return {
    property,
    order: propertyOrder("content.text"),
    slots: ["text:element"],
    subject: { kind: "element" },
    initialValue,
    normalize(value) {
      return normalizeBySchema(property, value);
    },
    apply(value) {
      context.element.textContent = String(value);
    },
    restore() {
      context.element.textContent = initialValue;
    },
  };
}

export function collectBindings(
  context: EditContext,
  adapters: readonly PropertyAdapter[],
): PropertyBinding[] {
  const bindings = adapters.flatMap((adapter) => adapter.collect(context));
  const ids = new Set<string>();
  const slots = new Map<string, string>();
  for (const binding of bindings) {
    if (ids.has(binding.property.id)) {
      throw new Error(`重复的元素编辑属性 id：${binding.property.id}`);
    }
    ids.add(binding.property.id);
    for (const slot of binding.slots) {
      const owner = slots.get(slot);
      if (owner) throw new Error(`元素编辑 mutation slot 冲突：${slot} (${owner}, ${binding.property.id})`);
      slots.set(slot, binding.property.id);
    }
  }
  return bindings.sort((left, right) => left.order - right.order || left.property.id.localeCompare(right.property.id));
}
