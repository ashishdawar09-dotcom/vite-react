import { beforeEach, describe, expect, it, vi } from "vitest";

// db.ts talks to Supabase, Sentry and the notify function; stub all three so
// the allocation path can be checked without a network.
const rpc = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const captureMessage = vi.fn();
const notifyCourtAllocated = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ update: (patch: unknown) => { update(patch); return { eq: (...a: unknown[]) => eq(...a) }; } }),
  },
}));
vi.mock("@sentry/react", () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a) }));
vi.mock("../notifications", () => ({ notifyCourtAllocated: (...a: unknown[]) => notifyCourtAllocated(...a) }));

const { allocateCourtAndNotify, reassignCourt } = await import("../db");
const { isCourtTaken, courtTakenMessage } = await import("../courts");

beforeEach(() => {
  rpc.mockReset(); update.mockReset(); eq.mockReset(); captureMessage.mockReset(); notifyCourtAllocated.mockReset();
  eq.mockResolvedValue({ error: null });
});

describe("allocateCourtAndNotify", () => {
  it("allocates through the allocate_court RPC, then notifies", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await allocateCourtAndNotify("m1", 2);
    expect(rpc).toHaveBeenCalledWith("allocate_court", { p_match_id: "m1", p_court: 2 });
    expect(update).not.toHaveBeenCalled();
    expect(notifyCourtAllocated).toHaveBeenCalledWith("m1");
  });

  it("does not notify anyone when the court is taken", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "court_taken: Court 2 is held by another match." } });
    const err = await allocateCourtAndNotify("m1", 2).catch(e => e);
    expect(isCourtTaken(err)).toBe(true);
    expect(notifyCourtAllocated).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("falls back to the direct update with a Sentry warning when the RPC is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.allocate_court" } });
    await allocateCourtAndNotify("m1", 3);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("allocate_court missing"), expect.objectContaining({ level: "warning" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ court_number: 3, court_allocated_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith("id", "m1");
    expect(notifyCourtAllocated).toHaveBeenCalledWith("m1");
  });

  it("rethrows other errors without notifying", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    await expect(allocateCourtAndNotify("m1", 2)).rejects.toMatchObject({ message: "forbidden" });
    expect(notifyCourtAllocated).not.toHaveBeenCalled();
  });
});

describe("reassignCourt", () => {
  it("moves a match through the same RPC and sends no notification", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await reassignCourt("m1", 4);
    expect(rpc).toHaveBeenCalledWith("allocate_court", { p_match_id: "m1", p_court: 4 });
    expect(notifyCourtAllocated).not.toHaveBeenCalled();
  });

  it("falls back to the court-only update when the RPC is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await reassignCourt("m1", 4);
    expect(update).toHaveBeenCalledWith({ court_number: 4 });
  });
});

describe("courtTakenMessage", () => {
  it("passes on the server's explanation without the code prefix", () => {
    expect(courtTakenMessage({ message: "court_taken: Court 2 is held by XD T4 v T3 (warming up)." }, 2))
      .toBe("Court 2 is held by XD T4 v T3 (warming up).");
    expect(courtTakenMessage({ message: "court_taken" }, 2)).toBe("Court 2 was just taken by another match. Pick another court.");
  });
});
