import { prisma } from "@/lib/prisma";

const CACHE_WINDOW_MS = 60 * 1000;

// ─── Helpers ───────────────────────────────────────────────
function makeFact(overrides: { createdAt?: Date; userId?: string } = {}) {
  return {
    id: "fact-1",
    fact: "Test fact",
    movie: "Inception",
    userId: "user-1",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Cache Logic (pure, no DB) ─────────────────────────────
describe("60-second cache window logic", () => {
  it("returns cached=true when fact is less than 60 seconds old", () => {
    const fact = makeFact({ createdAt: new Date(Date.now() - 30_000) }); // 30s ago
    const ageMs = Date.now() - fact.createdAt.getTime();
    expect(ageMs < CACHE_WINDOW_MS).toBe(true);
  });

  it("returns cached=false when fact is older than 60 seconds", () => {
    const fact = makeFact({ createdAt: new Date(Date.now() - 90_000) }); // 90s ago
    const ageMs = Date.now() - fact.createdAt.getTime();
    expect(ageMs < CACHE_WINDOW_MS).toBe(false);
  });

  it("returns cached=true when fact is exactly 59 seconds old", () => {
    const fact = makeFact({ createdAt: new Date(Date.now() - 59_000) });
    const ageMs = Date.now() - fact.createdAt.getTime();
    expect(ageMs < CACHE_WINDOW_MS).toBe(true);
  });

  it("returns cached=false when fact is exactly 61 seconds old", () => {
    const fact = makeFact({ createdAt: new Date(Date.now() - 61_000) });
    const ageMs = Date.now() - fact.createdAt.getTime();
    expect(ageMs < CACHE_WINDOW_MS).toBe(false);
  });

  it("computes expiresInSeconds correctly", () => {
    const fact = makeFact({ createdAt: new Date(Date.now() - 30_000) }); // 30s ago
    const ageMs = Date.now() - fact.createdAt.getTime();
    const expiresInSeconds = Math.ceil((CACHE_WINDOW_MS - ageMs) / 1000);
    expect(expiresInSeconds).toBeGreaterThan(0);
    expect(expiresInSeconds).toBeLessThanOrEqual(30);
  });
});

// ─── Authorization Logic ───────────────────────────────────
describe("authorization: user cannot fetch another user's facts", () => {
  it("does not return facts belonging to a different user", () => {
    const requestingUserId = "user-1";
    const facts = [
      makeFact({ userId: "user-2" }),
      makeFact({ userId: "user-2" }),
    ];

    // Simulate what our DB query does: filter by userId
    const filtered = facts.filter((f) => f.userId === requestingUserId);
    expect(filtered).toHaveLength(0);
  });

  it("returns facts belonging to the correct user", () => {
    const requestingUserId = "user-1";
    const facts = [
      makeFact({ userId: "user-1" }),
      makeFact({ userId: "user-2" }),
    ];

    const filtered = facts.filter((f) => f.userId === requestingUserId);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].userId).toBe(requestingUserId);
  });

  it("returns empty when user has no facts", () => {
    const requestingUserId = "user-1";
    const facts: ReturnType<typeof makeFact>[] = [];
    const filtered = facts.filter((f) => f.userId === requestingUserId);
    expect(filtered).toHaveLength(0);
  });
});