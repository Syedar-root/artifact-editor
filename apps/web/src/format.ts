export function formatMessageTime(timestamp: string | number | Date) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatSessionTime(timestamp: string | number | Date) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return formatMessageTime(timestamp);
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function formatElementSelector(element: {
  tagName?: string;
  id?: string;
  classNames?: string[];
}) {
  const name = element.tagName || "元素";
  if (element.id) return `${name}#${element.id}`;
  return element.classNames?.[0] ? `${name}.${element.classNames[0]}` : name;
}
