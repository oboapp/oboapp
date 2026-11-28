import { afterEach, describe, expect, it, vi } from "vitest";
import { hasConsent, hasConsentDecision, setConsent } from "./analytics";

describe("analytics consent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("ga_consent");
  });

  it("recognizes both saved decisions and enables analytics only after consent", () => {
    expect(hasConsentDecision()).toBe(false);
    setConsent(true);
    expect(hasConsentDecision()).toBe(true);
    expect(hasConsent()).toBe(true);
    setConsent(false);
    expect(hasConsentDecision()).toBe(true);
    expect(hasConsent()).toBe(false);
  });

  it("allows the public page to open and dismiss consent when storage is blocked", () => {
    function blockStorage() {
      throw new DOMException("Private storage is blocked", "SecurityError");
    }
    vi.stubGlobal("localStorage", { getItem: blockStorage, setItem: blockStorage });
    expect(hasConsentDecision()).toBe(false);
    setConsent(true);
    expect(hasConsent()).toBe(false);
  });
});
