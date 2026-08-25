// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantProvider, useAssistant } from "./assistant-provider";

function sseBody(lines: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    }
  });
}

function frame(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const validResponse = {
  headline: "Aug 20 was unusually expensive",
  metrics: [],
  body: [],
  evidence: [],
  visualizations: [],
  actions: [],
  suggestions: [],
  scope: { from: "2026-08-01", to: "2026-08-20" },
  toolsUsed: []
};

function Harness() {
  const { isPending, progress, error, turns, ask, open, close, recordRecentActionResult } = useAssistant();
  return (
    <div>
      <p data-testid="pending">{String(isPending)}</p>
      <p data-testid="progress">{progress ? `${progress.stage}:${progress.label}` : "none"}</p>
      <p data-testid="error">{error}</p>
      <p data-testid="turn-count">{turns.length}</p>
      <button onClick={() => open()} type="button">
        open
      </button>
      <button onClick={close} type="button">
        close
      </button>
      <button onClick={() => ask("What happened?")} type="button">
        ask
      </button>
      <button
        onClick={() =>
          recordRecentActionResult({
            type: "delete_activity",
            success: true,
            deletedActivity: {
              id: "11111111-1111-4111-8111-111111111111",
              startsAt: "2026-08-24T22:00:00",
              endsAt: "2026-08-25T05:00:00",
              allDay: false,
              tags: ["geyser"]
            }
          })
        }
        type="button"
      >
        record action
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <AssistantProvider isEnabled>
      <Harness />
    </AssistantProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AssistantProvider streaming", () => {
  it("parses started -> progress -> response frames, updating progress then clearing it once the final answer lands", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          sseBody([
            frame({ type: "started" }),
            frame({ type: "progress", stage: "usage", label: "Checking your usage…" }),
            frame({ type: "response", response: validResponse })
          ]),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    fireEvent.click(screen.getByText("ask"));

    expect(screen.getByTestId("pending").textContent).toBe("true");

    await waitFor(() => expect(screen.getByTestId("turn-count").textContent).toBe("2"));
    expect(screen.getByTestId("pending").textContent).toBe("false");
    expect(screen.getByTestId("progress").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("never puts progress events into turns/history -- only the final response event becomes a turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          sseBody([
            frame({ type: "started" }),
            frame({ type: "progress", stage: "usage", label: "Checking your usage…" }),
            frame({ type: "progress", stage: "alerts", label: "Reviewing your alerts…" }),
            frame({ type: "response", response: validResponse })
          ]),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    fireEvent.click(screen.getByText("ask"));

    await waitFor(() => expect(screen.getByTestId("turn-count").textContent).toBe("2"));
    // Exactly one user turn + one assistant turn -- the two progress events
    // never became turns of their own.
    expect(screen.getByTestId("turn-count").textContent).toBe("2");
  });

  it("removes the optimistic user turn and surfaces a sanitized message on an error event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody([frame({ type: "started" }), frame({ type: "error", message: "Failed to answer." })]), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    fireEvent.click(screen.getByText("ask"));

    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Failed to answer."));
    expect(screen.getByTestId("turn-count").textContent).toBe("0");
    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("keeps success when a later error frame arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            sseBody([
              frame({ type: "response", response: validResponse }),
              frame({ type: "error", message: "Failed to answer." })
            ]),
            { status: 200 }
          )
        )
    );
    renderHarness();
    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => expect(screen.getByTestId("turn-count").textContent).toBe("2"));
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("uses first terminal event when error precedes response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            sseBody([
              frame({ type: "error", message: "Failed to answer." }),
              frame({ type: "response", response: validResponse })
            ]),
            { status: 200 }
          )
        )
    );
    renderHarness();
    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Failed to answer."));
    expect(screen.getByTestId("turn-count").textContent).toBe("0");
  });

  it("ignores a malformed frame between progress and response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            sseBody([
              frame({ type: "progress", stage: "usage", label: "Checking…" }),
              "data: {bad json\n\n",
              frame({ type: "response", response: validResponse })
            ]),
            { status: 200 }
          )
        )
    );
    renderHarness();
    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => expect(screen.getByTestId("turn-count").textContent).toBe("2"));
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("sends a successful action result as typed context on the next request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(sseBody([frame({ type: "response", response: validResponse })]), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);
    renderHarness();
    fireEvent.click(screen.getByText("record action"));
    fireEvent.click(screen.getByText("ask"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.context.recentActionResult).toMatchObject({
      type: "delete_activity",
      success: true,
      deletedActivity: { id: "11111111-1111-4111-8111-111111111111" }
    });
  });

  it("aborts the in-flight fetch when close() is called, and does not get stuck pending", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      // Never resolves on its own -- only abort() settles it, mirroring a
      // real in-flight request the user navigated away from.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByText("ask"));
    expect(screen.getByTestId("pending").textContent).toBe("true");

    fireEvent.click(screen.getByText("close"));

    expect(screen.getByTestId("pending").textContent).toBe("false");
    expect(capturedSignal?.aborted).toBe(true);
    // No error surfaced from a deliberate user-initiated cancellation.
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe(""));
  });

  it("allows a new ask() immediately after an abort -- isPending doesn't stay stuck and retry works", async () => {
    let resolveSecond: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      })
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveSecond = resolve)));
    vi.stubGlobal("fetch", fetchMock);

    renderHarness();
    fireEvent.click(screen.getByText("ask"));
    fireEvent.click(screen.getByText("close"));
    expect(screen.getByTestId("pending").textContent).toBe("false");

    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByText("ask"));
    expect(screen.getByTestId("pending").textContent).toBe("true");

    resolveSecond?.(
      new Response(sseBody([frame({ type: "started" }), frame({ type: "response", response: validResponse })]), {
        status: 200
      })
    );

    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("false"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
