import { describe, beforeEach, afterAll, it, expect } from "vitest";
import {
  DEFAULT_MAX_MESSAGES_LIMIT,
  getMaxMessagesLimit,
  getDefaultUnfilteredMessagesLimit,
  clampMessagesLimit,
} from "./messages-limit-config";

describe("messages-limit-config", () => {
  const ORIGINAL_MAX = process.env.PUBLIC_API_MESSAGES_MAX_LIMIT;
  const ORIGINAL_DEFAULT = process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT;

  beforeEach(() => {
    delete process.env.PUBLIC_API_MESSAGES_MAX_LIMIT;
    delete process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT;
  });

  afterAll(() => {
    if (ORIGINAL_MAX === undefined) {
      delete process.env.PUBLIC_API_MESSAGES_MAX_LIMIT;
    } else {
      process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = ORIGINAL_MAX;
    }

    if (ORIGINAL_DEFAULT === undefined) {
      delete process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT;
    } else {
      process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT = ORIGINAL_DEFAULT;
    }
  });

  it("uses default max when env is missing", () => {
    expect(getMaxMessagesLimit()).toBe(DEFAULT_MAX_MESSAGES_LIMIT);
  });

  it("uses max from env when valid", () => {
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = "250";
    expect(getMaxMessagesLimit()).toBe(250);
  });

  it("falls back to default max when max env is invalid", () => {
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = "invalid";
    expect(getMaxMessagesLimit()).toBe(DEFAULT_MAX_MESSAGES_LIMIT);
  });

  it("clamps default unfiltered limit to max", () => {
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = "100";
    process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT = "500";

    expect(getDefaultUnfilteredMessagesLimit()).toBe(100);
  });

  it("returns explicit default unfiltered limit when valid and <= max", () => {
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = "500";
    process.env.PUBLIC_API_MESSAGES_DEFAULT_LIMIT = "150";

    expect(getDefaultUnfilteredMessagesLimit()).toBe(150);
  });

  it("clamps provided request limit to max", () => {
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = "300";
    expect(clampMessagesLimit(999)).toBe(300);
  });

  it("returns max when request limit is undefined", () => {
    process.env.PUBLIC_API_MESSAGES_MAX_LIMIT = "400";
    expect(clampMessagesLimit(undefined)).toBe(400);
  });
});
