import {
  attributeBinding,
  domPropertyBinding,
  styleBinding,
} from "../binding.ts";
import type { EditContext, PropertyAdapter, PropertyBinding } from "../binding.ts";

function tagName(context: EditContext): string {
  return context.element.tagName.toLowerCase();
}

export const linkAdapter: PropertyAdapter = {
  id: "link",
  collect(context) {
    if (tagName(context) !== "a") return [];
    return [
      attributeBinding(context, "link.href", "href"),
      attributeBinding(context, "link.target", "target", { fallback: "_self" }),
    ];
  },
};

export const formAdapter: PropertyAdapter = {
  id: "form",
  collect(context) {
    const tag = tagName(context);
    if (!["button", "input", "option", "select", "textarea"].includes(tag)) return [];
    const element = context.element as Element & {
      value?: unknown;
      checked?: unknown;
      disabled?: unknown;
    };
    const bindings: PropertyBinding[] = [];
    if (["input", "option", "select", "textarea"].includes(tag) && typeof element.value === "string") {
      bindings.push(domPropertyBinding(context, "form.value", "value", element.value));
    }
    if (["input", "textarea"].includes(tag)) {
      bindings.push(attributeBinding(context, "form.placeholder", "placeholder"));
    }
    const inputType = context.element.getAttribute("type")?.toLowerCase();
    if (tag === "input" && ["checkbox", "radio"].includes(inputType ?? "") && typeof element.checked === "boolean") {
      bindings.push(domPropertyBinding(context, "form.checked", "checked", element.checked));
    }
    if (typeof element.disabled === "boolean") {
      bindings.push(domPropertyBinding(context, "form.disabled", "disabled", element.disabled));
    }
    return bindings;
  },
};

export const imageAdapter: PropertyAdapter = {
  id: "image",
  collect(context) {
    if (tagName(context) !== "img") return [];
    const bindings: Array<PropertyBinding | null> = [
      attributeBinding(context, "media.src", "src"),
      attributeBinding(context, "media.alt", "alt"),
      styleBinding(context, "media.objectFit", "object-fit", "objectFit", "fill"),
    ];
    return bindings.filter((binding): binding is PropertyBinding => !!binding);
  },
};

export const backgroundImageAdapter: PropertyAdapter = {
  id: "background-image",
  collect(context) {
    const backgroundImage = context.computedStyle?.backgroundImage || "none";
    if (backgroundImage === "none") return [];
    const binding = styleBinding(
      context,
      "media.backgroundImage",
      "background-image",
      "backgroundImage",
      "none",
    );
    return binding ? [binding] : [];
  },
};
