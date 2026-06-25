/// <reference types="vitest" />
/// <reference types="vitest/globals" />

import type { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

declare global {
  const describe: typeof describe;
  const it: typeof it;
  const expect: typeof expect;
  const beforeEach: typeof beforeEach;
  const afterAll: typeof afterAll;
  const vi: typeof vi;
}

export {};
