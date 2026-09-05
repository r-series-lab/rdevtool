import type { KeyboardEvent } from "react";

export function shouldHandlePrimaryEnter(event: KeyboardEvent<HTMLElement>) {
  if (
    event.key !== "Enter" ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return false;
  }

  const target = event.target as HTMLElement | null;
  if (!target) {
    return true;
  }

  const tagName = target.tagName;
  const role = target.getAttribute("role");
  const expanded = target.getAttribute("aria-expanded");

  if (
    target.isContentEditable ||
    tagName === "TEXTAREA" ||
    tagName === "BUTTON" ||
    tagName === "A" ||
    role === "button" ||
    role === "option" ||
    role === "menuitem" ||
    (role === "combobox" && expanded === "true")
  ) {
    return false;
  }

  return true;
}
