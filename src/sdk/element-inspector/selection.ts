import type { ElementSelection } from "./types";

const MAX_CLASS_NAMES = 3;

function buildHint(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.id;
  const classNames = Array.from(element.classList).slice(0, MAX_CLASS_NAMES);
  return `${tagName}${id ? `#${id}` : ""}${classNames
    .map((className) => `.${className}`)
    .join("")}`;
}

export function describeElement(element: Element): ElementSelection {
  const tagName = element.tagName.toLowerCase();
  const id = element.id;
  const classNames = Array.from(element.classList).slice(0, MAX_CLASS_NAMES);

  return {
    tagName,
    id,
    classNames,
    hint: buildHint(element),
  };
}
