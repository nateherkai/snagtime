"use client";

import { useEffect } from "react";

let alertSequence = 0;

function focusAlert(alert: HTMLElement) {
  if (!alert.id) alert.id = `ui-error-${++alertSequence}`;
  alert.tabIndex = -1;
  const form = alert.closest("form");
  const invalid = form?.querySelectorAll<HTMLElement>("input:invalid, select:invalid, textarea:invalid, [aria-invalid='true']") ?? [];
  invalid.forEach((control) => {
    const ids = new Set((control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
    ids.add(alert.id);
    control.setAttribute("aria-describedby", [...ids].join(" "));
    control.setAttribute("aria-invalid", "true");
  });
  if (alert.getClientRects().length) alert.focus({ preventScroll: false });
}

export function AccessibilityFocusManager() {
  useEffect(() => {
    const visit = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches("[role='alert']")) focusAlert(node);
      node.querySelectorAll<HTMLElement>("[role='alert']").forEach(focusAlert);
    };
    document.querySelectorAll<HTMLElement>("[role='alert']").forEach(focusAlert);
    const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(visit)));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
