import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockWebSocket } from "../../tests/mockServer";
import { useEvents } from "./ws";

describe("useEvents", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("connects and appends incoming events", async () => {
    const { result } = renderHook(() => useEvents());
    await waitFor(() => expect(result.current.connected).toBe(true));
    const socket = MockWebSocket.instances[0];
    act(() =>
      socket.emit({ id: 1, ts: "now", type: "run.started", payload: {} }),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
  });
});
