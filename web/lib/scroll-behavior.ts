export function getPreferredScrollBehavior(): ScrollBehavior {
  return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "instant"
    : "smooth";
}
