import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/bounds-utils", () => ({
  getLocalityCenter: () => ({ lat: 42.6977, lng: 23.3219 }),
}));

// This test exercises the list and panel, not Google Maps. Prevent the loader
// from leaving a retry timer running after the DOM test environment closes.
vi.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({ isLoaded: false, loadError: null }),
  GoogleMap: () => null,
  Marker: () => null,
  Polyline: () => null,
}));

describe("GeocodeCacheClient accessibility", () => {
  it("renders tappable overlay as button when panel is open", async () => {
    const user = userEvent.setup();
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LOCALITY", "bg.sofia");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("/api/geocode-cache/report")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                generatedAt: new Date().toISOString(),
                messagesAnalyzed: 1,
                pins: [],
                streets: [
                  {
                    key: "street-1",
                    originalText: "бул. Витоша",
                    count: 5,
                    cached: true,
                    messageIds: ["m-1"],
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }

        if (url.startsWith("/api/geocode-cache/geometries")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                items: [
                  {
                    messageId: "m-1",
                    coordinates: [
                      [
                        { lat: 42.6977, lng: 23.3219 },
                        { lat: 42.698, lng: 23.3222 },
                      ],
                    ],
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      });

    (globalThis as unknown as { google: unknown }).google = {
      maps: {
        SymbolPath: { CIRCLE: 0 },
        LatLngBounds: class {
          extend() {}
          isEmpty() {
            return false;
          }
        },
      },
    };

    const { default: GeocodeCacheClient } = await import("./GeocodeCacheClient");

    render(<GeocodeCacheClient />);

    const entryButton = await screen.findByRole("button", {
      name: /бул\. Витоша/i,
    });
    await user.click(entryButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Затвори панела" }),
      ).toBeInTheDocument();
    });

    fetchMock.mockRestore();
  });
});
