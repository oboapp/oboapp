import { describe, expect, it } from "vitest";
import { validateConditionalUpdate } from "./conditional-update";

describe("conditional update input", () => {
  it("accepts string tokens and plain fields including the rotated token", () => {
    expect(() => validateConditionalUpdate("leaseToken", "$old", { leaseToken: "new", attempts: 1 })).not.toThrow();
  });

  it.each(["", "_id", "lease.token", "$lease"])("rejects invalid token field %s", (field) => {
    expect(() => validateConditionalUpdate(field, "old", { leaseToken: "new" })).toThrow(TypeError);
  });

  it.each([{}, { $set: { leaseToken: "new" } }, { "lease.token": "new" }, { _id: "changed" }, { value: undefined }])("rejects invalid updates %j", (data) => {
    expect(() => validateConditionalUpdate("leaseToken", "old", data)).toThrow(TypeError);
  });
});
