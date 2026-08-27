import { describe, expect, it, vi } from "vitest";
import { readBoundedText } from "@/server/http";

describe("bounded request body streaming", () => {
  it("cancels the reader as soon as the streamed body exceeds the cap", async () => {
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); },
      cancel,
    });
    await expect(readBoundedText(new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit), 10)).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects an oversized declared length before reading", async () => {
    await expect(readBoundedText(new Request("http://localhost", { method: "POST", headers: { "content-length": "11" }, body: "ok" }), 10)).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
});
