import type {
  ElementEditGroup,
  ElementEditProperty,
  ElementEditPropertyKey,
  ElementEditPropertyValue,
  ElementEditSchema,
} from "./types.ts";

interface PropertyDefinition {
  group: ElementEditGroup;
  order: number;
  schema: ElementEditSchema;
}

const FONT_WEIGHT_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FONT_STYLE_OPTIONS = ["normal", "italic", "oblique"];
const TEXT_ALIGN_OPTIONS = ["start", "left", "center", "right", "end", "justify"];
const OBJECT_FIT_OPTIONS = ["fill", "contain", "cover", "none", "scale-down"];
const LINK_TARGET_OPTIONS = ["_self", "_blank", "_parent", "_top"];
const DISPLAY_OPTIONS = ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "none"];
const FLEX_DIRECTION_OPTIONS = ["row", "row-reverse", "column", "column-reverse"];
const JUSTIFY_CONTENT_OPTIONS = ["normal", "start", "center", "end", "space-between", "space-around", "space-evenly"];
const ALIGN_ITEMS_OPTIONS = ["normal", "stretch", "start", "center", "end", "baseline"];
const BORDER_STYLE_OPTIONS = ["none", "solid", "dashed", "dotted", "double"];

const definitions: Record<ElementEditPropertyKey, PropertyDefinition> = {
  "content.text": { group: "content", order: 100, schema: { kind: "text", allowEmpty: true } },
  "form.value": { group: "form", order: 200, schema: { kind: "text", allowEmpty: true } },
  "form.placeholder": { group: "form", order: 210, schema: { kind: "text", allowEmpty: true } },
  "form.checked": { group: "form", order: 220, schema: { kind: "boolean" } },
  "form.disabled": { group: "form", order: 230, schema: { kind: "boolean" } },
  "link.href": { group: "link", order: 300, schema: { kind: "url", allowEmpty: true } },
  "link.target": { group: "link", order: 310, schema: { kind: "choice", options: LINK_TARGET_OPTIONS } },
  "media.src": { group: "media", order: 400, schema: { kind: "url", allowEmpty: true } },
  "media.alt": { group: "media", order: 410, schema: { kind: "text", allowEmpty: true } },
  "media.objectFit": { group: "media", order: 420, schema: { kind: "choice", options: OBJECT_FIT_OPTIONS } },
  "media.backgroundImage": { group: "media", order: 430, schema: { kind: "text" } },
  "typography.fontFamily": { group: "typography", order: 500, schema: { kind: "text" } },
  "typography.fontSize": { group: "typography", order: 510, schema: { kind: "length" } },
  "typography.fontWeight": { group: "typography", order: 520, schema: { kind: "choice", options: FONT_WEIGHT_OPTIONS } },
  "typography.fontStyle": { group: "typography", order: 530, schema: { kind: "choice", options: FONT_STYLE_OPTIONS } },
  "typography.lineHeight": { group: "typography", order: 540, schema: { kind: "length", allowKeywords: true } },
  "typography.textAlign": { group: "typography", order: 550, schema: { kind: "choice", options: TEXT_ALIGN_OPTIONS } },
  "typography.color": { group: "typography", order: 560, schema: { kind: "color" } },
  "size.width": { group: "size", order: 600, schema: { kind: "length", allowKeywords: true } },
  "size.height": { group: "size", order: 610, schema: { kind: "length", allowKeywords: true } },
  "size.aspectRatio": { group: "size", order: 620, schema: { kind: "text" } },
  "layout.display": { group: "layout", order: 700, schema: { kind: "choice", options: DISPLAY_OPTIONS } },
  "layout.flexDirection": { group: "layout", order: 710, schema: { kind: "choice", options: FLEX_DIRECTION_OPTIONS } },
  "layout.justifyContent": { group: "layout", order: 720, schema: { kind: "choice", options: JUSTIFY_CONTENT_OPTIONS } },
  "layout.alignItems": { group: "layout", order: 730, schema: { kind: "choice", options: ALIGN_ITEMS_OPTIONS } },
  "layout.gap": { group: "layout", order: 740, schema: { kind: "length" } },
  "spacing.marginTop": { group: "spacing", order: 800, schema: { kind: "length", allowKeywords: true } },
  "spacing.marginRight": { group: "spacing", order: 810, schema: { kind: "length", allowKeywords: true } },
  "spacing.marginBottom": { group: "spacing", order: 820, schema: { kind: "length", allowKeywords: true } },
  "spacing.marginLeft": { group: "spacing", order: 830, schema: { kind: "length", allowKeywords: true } },
  "spacing.paddingTop": { group: "spacing", order: 840, schema: { kind: "length" } },
  "spacing.paddingRight": { group: "spacing", order: 850, schema: { kind: "length" } },
  "spacing.paddingBottom": { group: "spacing", order: 860, schema: { kind: "length" } },
  "spacing.paddingLeft": { group: "spacing", order: 870, schema: { kind: "length" } },
  "appearance.backgroundColor": { group: "appearance", order: 900, schema: { kind: "color" } },
  "appearance.borderColor": { group: "appearance", order: 910, schema: { kind: "color" } },
  "appearance.borderWidth": { group: "appearance", order: 920, schema: { kind: "length" } },
  "appearance.borderStyle": { group: "appearance", order: 930, schema: { kind: "choice", options: BORDER_STYLE_OPTIONS } },
  "appearance.borderRadius": { group: "appearance", order: 940, schema: { kind: "length" } },
  "appearance.opacity": { group: "appearance", order: 950, schema: { kind: "number", min: 0, max: 1, step: 0.05 } },
};

function withCurrentChoice(
  schema: ElementEditSchema,
  value: ElementEditPropertyValue,
): ElementEditSchema {
  if (schema.kind !== "choice" || schema.options.includes(value as string | number)) {
    return schema.kind === "choice" ? { ...schema, options: [...schema.options] } : { ...schema };
  }
  if (typeof value !== "string" && typeof value !== "number") return schema;
  return { ...schema, options: [value, ...schema.options] };
}

export function createProperty(
  key: ElementEditPropertyKey,
  value: ElementEditPropertyValue,
  id: string = key,
): ElementEditProperty {
  const definition = definitions[key];
  return {
    id,
    key,
    group: definition.group,
    value,
    schema: withCurrentChoice(definition.schema, value),
  };
}

export function propertyOrder(key: ElementEditPropertyKey): number {
  return definitions[key].order;
}
