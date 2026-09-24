import { styleBinding } from "../binding.ts";
import type { PropertyAdapter, PropertyBinding } from "../binding.ts";

function compact(bindings: Array<PropertyBinding | null>): PropertyBinding[] {
  return bindings.filter((binding): binding is PropertyBinding => !!binding);
}

export const boxAdapter: PropertyAdapter = {
  id: "box",
  collect(context) {
    return compact([
      styleBinding(context, "size.width", "width", "width", `${context.inspection.boxModel.rect.width}px`),
      styleBinding(context, "size.height", "height", "height", `${context.inspection.boxModel.rect.height}px`),
      styleBinding(context, "size.aspectRatio", "aspect-ratio", "aspectRatio", "auto"),
    ]);
  },
};

export const spacingAdapter: PropertyAdapter = {
  id: "spacing",
  collect(context) {
    return compact([
      styleBinding(context, "spacing.marginTop", "margin-top", "marginTop", "0px"),
      styleBinding(context, "spacing.marginRight", "margin-right", "marginRight", "0px"),
      styleBinding(context, "spacing.marginBottom", "margin-bottom", "marginBottom", "0px"),
      styleBinding(context, "spacing.marginLeft", "margin-left", "marginLeft", "0px"),
      styleBinding(context, "spacing.paddingTop", "padding-top", "paddingTop", "0px"),
      styleBinding(context, "spacing.paddingRight", "padding-right", "paddingRight", "0px"),
      styleBinding(context, "spacing.paddingBottom", "padding-bottom", "paddingBottom", "0px"),
      styleBinding(context, "spacing.paddingLeft", "padding-left", "paddingLeft", "0px"),
    ]);
  },
};

export const layoutAdapter: PropertyAdapter = {
  id: "layout",
  collect(context) {
    const display = context.computedStyle?.display || "block";
    const bindings: Array<PropertyBinding | null> = [
      styleBinding(context, "layout.display", "display", "display", display),
    ];
    if (display.includes("flex")) {
      bindings.push(
        styleBinding(context, "layout.flexDirection", "flex-direction", "flexDirection", "row"),
        styleBinding(context, "layout.justifyContent", "justify-content", "justifyContent", "normal"),
        styleBinding(context, "layout.alignItems", "align-items", "alignItems", "normal"),
        styleBinding(context, "layout.gap", "gap", "gap", "0px"),
      );
    } else if (display.includes("grid")) {
      bindings.push(
        styleBinding(context, "layout.justifyContent", "justify-content", "justifyContent", "normal"),
        styleBinding(context, "layout.alignItems", "align-items", "alignItems", "normal"),
        styleBinding(context, "layout.gap", "gap", "gap", "0px"),
      );
    }
    return compact(bindings);
  },
};

export const appearanceAdapter: PropertyAdapter = {
  id: "appearance",
  collect(context) {
    const opacity = Number.parseFloat(context.computedStyle?.opacity || "1");
    return compact([
      styleBinding(context, "appearance.backgroundColor", "background-color", "backgroundColor", "rgba(0, 0, 0, 0)"),
      styleBinding(context, "appearance.borderColor", "border-color", "borderColor", "currentColor"),
      styleBinding(context, "appearance.borderWidth", "border-width", "borderWidth", "0px"),
      styleBinding(context, "appearance.borderStyle", "border-style", "borderStyle", "none"),
      styleBinding(context, "appearance.borderRadius", "border-radius", "borderRadius", "0px"),
      styleBinding(context, "appearance.opacity", "opacity", "opacity", "1", {
        value: Number.isFinite(opacity) ? opacity : 1,
      }),
    ]);
  },
};
