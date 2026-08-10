import type { ThemePreference } from "../types";

/**
 * Resolve a stored theme preference to an actual "dark" | "light" value.
 * "system" follows the OS color scheme via `prefers-color-scheme`.
 */
export function resolveTheme(
  preference: ThemePreference | undefined | null,
): "dark" | "light" {
  if (preference === "system") {
    return isSystemLight() ? "light" : "dark";
  }
  return preference === "light" ? "light" : "dark";
}

export function isSystemLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

/**
 * Subscribe to OS color-scheme changes. Returns an unsubscribe function.
 * Uses the modern addEventListener API with a fallback for older webviews.
 */
export function subscribeSystemTheme(callback: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => callback();
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}
