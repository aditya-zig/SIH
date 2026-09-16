import { describe, expect, it } from "vitest";
import { isUsableSupabaseEnvValue, isUsableSupabaseUrl, verifyCertificate } from "./data";

describe("verifyCertificate", () => {
  it("does not fabricate verification without a configured backend", async () => {
    await expect(verifyCertificate("cert-dead2026abcdef01")).resolves.toEqual({
      valid: false,
      certificateCode: "CERT-DEAD2026ABCDEF01",
    });
  });

  it("does not verify an unknown demonstration code", async () => {
    await expect(verifyCertificate("CERT-UNKNOWN0000000")).resolves.toEqual({
      valid: false,
      certificateCode: "CERT-UNKNOWN0000000",
    });
  });
});

describe("supabase env guard", () => {
  it("rejects the checked-in .env.example placeholders", () => {
    expect(isUsableSupabaseUrl("https://your-project.supabase.co")).toBe(false);
    expect(isUsableSupabaseEnvValue("your-publishable-key")).toBe(false);
  });

  it("rejects empty and obvious placeholder values", () => {
    expect(isUsableSupabaseEnvValue(undefined)).toBe(false);
    expect(isUsableSupabaseEnvValue("   ")).toBe(false);
    expect(isUsableSupabaseEnvValue("placeholder-key")).toBe(false);
    expect(isUsableSupabaseEnvValue("CHANGEME")).toBe(false);
    expect(isUsableSupabaseUrl("https://example.supabase.co")).toBe(false);
    expect(isUsableSupabaseUrl("not-a-url")).toBe(false);
  });

  it("accepts real https and local http urls with a non-placeholder key", () => {
    expect(isUsableSupabaseUrl("https://abc123.supabase.co")).toBe(true);
    expect(isUsableSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isUsableSupabaseEnvValue("sb_publishable_realkey123")).toBe(true);
  });
});
