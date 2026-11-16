import { describe, expect, it } from "vitest";
import { sanitizeDiagnosticText, sanitizeError, serializeError } from "./error-diagnostics";

describe("error diagnostics", () => {
  it("bounds deeply nested causes", () => {
    let error = new Error("initial failure");
    for (let index = 0; index < 20; index++) {
      error = new Error(`wrapper ${index}`, { cause: error });
    }

    const output = JSON.stringify(serializeError(error));

    expect(output).toContain("[error depth limit]");
    expect(output).not.toContain("initial failure");
  });

  it("bounds aggregate error breadth", () => {
    const errors = Array.from({ length: 100 }, (_, index) => {
      return new Error(`connection ${index}`);
    });

    const diagnostic = serializeError(new AggregateError(errors, "all failed"));

    expect(diagnostic).toMatchObject({ name: "AggregateError", message: "all failed" });
    expect(JSON.stringify(diagnostic)).toContain("connection 9");
    expect(JSON.stringify(diagnostic)).not.toContain("connection 10");
  });

  it("preserves AggregateError identity when reporting sanitized exceptions", () => {
    const error = new AggregateError([
      Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    ], "fetch failed");

    const sanitized = sanitizeError(error);

    expect(sanitized).toBeInstanceOf(AggregateError);
    expect(sanitized.stack).toBe(error.stack);
    expect((sanitized as AggregateError).errors[0]).toMatchObject({
      message: "connection reset",
      code: "ECONNRESET",
    });
  });

  it("ignores getters that throw while collecting diagnostics", () => {
    const error = new Error("fetch failed");
    Object.defineProperty(error, "code", {
      get() {
        throw new Error("unreadable code");
      },
    });

    expect(serializeError(error)).toMatchObject({ message: "fetch failed" });
  });

  it("supports scalar non-Error causes", () => {
    expect(serializeError(new Error("fetch failed", { cause: "connection closed" })))
      .toMatchObject({ message: "fetch failed", cause: "connection closed" });
    expect(serializeError(BigInt(123))).toBe("123");
  });

  it("removes private URL parts while keeping provider identity and path", () => {
    const message = "Failed https://user:password@provider.example/feed?token=private#person";

    expect(sanitizeDiagnosticText(message)).toBe("Failed https://provider.example/feed");
  });

  it("preserves stack frame punctuation after a private URL", () => {
    const stack = "at request (https://user:password@provider.example/feed?token=private#person)";

    expect(sanitizeDiagnosticText(stack)).toBe("at request (https://provider.example/feed)");
  });

  it("redacts URL credentials containing a closing parenthesis", () => {
    const message = "Failed https://user:pass)word@provider.example/feed?token=private";

    expect(sanitizeDiagnosticText(message)).toBe("Failed https://provider.example/feed");
  });
});
