import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { checkStaffPassword, makeSessionValue, verifySessionValue } = await import("./staff");

describe("staff session", () => {
  beforeAll(() => {
    process.env.STAFF_SESSION_SECRET = "x".repeat(40);
  });

  it("accepts its own fresh session and rejects tampering or expiry", () => {
    const now = Date.UTC(2026, 9, 9, 17);
    const v = makeSessionValue(now);
    expect(verifySessionValue(v, now)).toBe(true);
    expect(verifySessionValue(v.replace(/\.(\d+)\./, (_, e) => `.${Number(e) + 999999}.`), now)).toBe(false);
    expect(verifySessionValue(`${v}x`, now)).toBe(false);
    expect(verifySessionValue(v, now + 17 * 3600_000)).toBe(false);
    expect(verifySessionValue(undefined, now)).toBe(false);
  });

  it("rejects sessions signed with a different secret", () => {
    const v = makeSessionValue();
    process.env.STAFF_SESSION_SECRET = "y".repeat(40);
    expect(verifySessionValue(v)).toBe(false);
    process.env.STAFF_SESSION_SECRET = "x".repeat(40);
  });

  it("locks everyone out when no password is configured", () => {
    delete process.env.STAFF_PASSWORD;
    expect(checkStaffPassword("")).toBe(false);
    process.env.STAFF_PASSWORD = "open sesame";
    expect(checkStaffPassword("open sesame")).toBe(true);
    expect(checkStaffPassword("open sesam")).toBe(false);
  });
});
