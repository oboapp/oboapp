import { describe, it, expect, vi, beforeEach } from "vitest";
import { findBestMatch } from "./match";

vi.mock("./candidates", () => ({
  findCandidateEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("./score", () => ({
  computeMatchScore: vi.fn().mockReturnValue({
    score: 0,
    signals: { locationSimilarity: 0, timeOverlap: 0, categoryMatch: 0, textSimilarity: 0 },
  }),
}));

vi.mock("./llm-verify", () => ({
  verifyEventMatch: vi.fn().mockResolvedValue(null),
}));

import { findCandidateEvents } from "./candidates";
import { computeMatchScore } from "./score";
import { verifyEventMatch } from "./llm-verify";

const mockDb = {} as any;

describe("findBestMatch", () => {
  beforeEach(() => {
    vi.mocked(findCandidateEvents).mockReset().mockResolvedValue([]);
    vi.mocked(computeMatchScore).mockReset().mockReturnValue({
      score: 0,
      signals: { locationSimilarity: 0, timeOverlap: 0, categoryMatch: 0, textSimilarity: 0 },
    });
    vi.mocked(verifyEventMatch).mockReset().mockResolvedValue(null);
  });

  it("returns null when no candidates", async () => {
    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
    });
    expect(result.match).toBeNull();
    expect(result.candidateCount).toBe(0);
  });

  it("returns null when all candidates score below LLM_VERIFY_LOWER (0.55)", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.4,
      signals: { locationSimilarity: 0.5, timeOverlap: 0.3, categoryMatch: 0, textSimilarity: 0 },
    });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
    });
    expect(result.match).toBeNull();
    expect(result.candidateCount).toBe(1);
    expect(verifyEventMatch).not.toHaveBeenCalled();
  });

  it("returns best match when above MATCH_THRESHOLD (0.70) without LLM call", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.85,
      signals: { locationSimilarity: 0.9, timeOverlap: 0.8, categoryMatch: 1.0, textSimilarity: 0 },
    });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
    });
    expect(result.match).not.toBeNull();
    expect(result.match!.event._id).toBe("evt-1");
    expect(result.match!.score).toBe(0.85);
    expect(result.candidateCount).toBe(1);
    expect(verifyEventMatch).not.toHaveBeenCalled();
  });

  it("picks highest scoring candidate when multiple match above threshold", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1" },
      { _id: "evt-2" },
    ]);
    vi.mocked(computeMatchScore)
      .mockReturnValueOnce({
        score: 0.75,
        signals: { locationSimilarity: 0.7, timeOverlap: 0.7, categoryMatch: 1.0, textSimilarity: 0 },
      })
      .mockReturnValueOnce({
        score: 0.92,
        signals: { locationSimilarity: 1.0, timeOverlap: 0.9, categoryMatch: 1.0, textSimilarity: 0 },
      });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
    });
    expect(result.match!.event._id).toBe("evt-2");
    expect(result.match!.score).toBe(0.92);
    expect(result.candidateCount).toBe(2);
  });

  // --- LLM verification zone tests ---

  it("calls LLM verify when score is in uncertain zone (0.55-0.70) and attaches if confirmed", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1", plainText: "Event text about water outage" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.6,
      signals: { locationSimilarity: 0.6, timeOverlap: 0.7, categoryMatch: 1.0, textSimilarity: 0.4 },
    });
    vi.mocked(verifyEventMatch).mockResolvedValueOnce({
      isSameEvent: true,
      reasoning: "Both describe water outage on same street",
    });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
      plainText: "Message text about water outage",
    });

    expect(verifyEventMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: "Message text about water outage",
        eventText: "Event text about water outage",
      }),
    );
    expect(result.match).not.toBeNull();
    expect(result.match!.event._id).toBe("evt-1");
    expect(result.match!.score).toBe(0.6);
    expect(result.match!.llmVerified).toBe(true);
    expect(result.candidateCount).toBe(1);
  });

  it("returns null when LLM rejects match in uncertain zone", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1", plainText: "Road repair on Vitosha" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.6,
      signals: { locationSimilarity: 0.5, timeOverlap: 0.7, categoryMatch: 1.0, textSimilarity: 0.5 },
    });
    vi.mocked(verifyEventMatch).mockResolvedValueOnce({
      isSameEvent: false,
      reasoning: "Different locations despite similar categories",
    });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
      plainText: "Heating outage in Lozenets",
    });

    expect(verifyEventMatch).toHaveBeenCalled();
    expect(result.match).toBeNull();
    expect(result.candidateCount).toBe(1);
  });

  it("returns null when LLM call fails in uncertain zone (conservative fallback)", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1", plainText: "Some event text" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.6,
      signals: { locationSimilarity: 0.6, timeOverlap: 0.6, categoryMatch: 1.0, textSimilarity: 0.5 },
    });
    vi.mocked(verifyEventMatch).mockResolvedValueOnce(null);

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
      plainText: "Some message text",
    });

    expect(verifyEventMatch).toHaveBeenCalled();
    expect(result.match).toBeNull();
    expect(result.candidateCount).toBe(1);
  });

  it("skips LLM verify when message has no text", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1", plainText: "Some event" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.6,
      signals: { locationSimilarity: 0.6, timeOverlap: 0.6, categoryMatch: 1.0, textSimilarity: 0.5 },
    });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
      // no text or plainText
    });

    expect(verifyEventMatch).not.toHaveBeenCalled();
    expect(result.match).toBeNull();
    expect(result.candidateCount).toBe(1);
  });

  it("skips LLM verify when event has no canonical text", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1" }, // no plainText
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.6,
      signals: { locationSimilarity: 0.6, timeOverlap: 0.6, categoryMatch: 1.0, textSimilarity: 0.5 },
    });

    const result = await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
      plainText: "Some message",
    });

    expect(verifyEventMatch).not.toHaveBeenCalled();
    expect(result.match).toBeNull();
    expect(result.candidateCount).toBe(1);
  });

  it("uses text field as fallback when plainText is missing", async () => {
    vi.mocked(findCandidateEvents).mockResolvedValueOnce([
      { _id: "evt-1", plainText: "Event text" },
    ]);
    vi.mocked(computeMatchScore).mockReturnValueOnce({
      score: 0.6,
      signals: { locationSimilarity: 0.6, timeOverlap: 0.6, categoryMatch: 1.0, textSimilarity: 0.5 },
    });
    vi.mocked(verifyEventMatch).mockResolvedValueOnce({
      isSameEvent: true,
      reasoning: "Match",
    });

    await findBestMatch(mockDb, {
      locality: "bg.sofia",
      geoJson: null,
      text: "Fallback text field",
    });

    expect(verifyEventMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: "Fallback text field",
      }),
    );
  });
});
