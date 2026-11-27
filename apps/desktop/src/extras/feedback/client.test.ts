import { describe, expect, it, vi } from "vitest";
import { MarketplaceClientError } from "../../main/marketplace-response";
import { FeedbackClient } from "./client";

const wireItem = {
  id: "f1",
  tag: "",
  content: "保存后闪退",
  status: "processing",
  reply: "已排期",
  replied_at: "2026-11-01T08:00:00.123Z",
  images: [{ id: "i1", content_type: "image/webp", byte_size: 12 }],
  created_at: "2026-11-01T07:00:00.123Z",
  updated_at: "2026-11-01T08:00:00+00:00"
};

function clientFor(result: unknown) {
  const request = vi.fn(async () => result);
  return {
    request,
    client: new FeedbackClient(
      { request },
      { version: "1.7.9", platform: "darwin" },
      async () => "MacBookPro18,3"
    )
  };
}

describe("FeedbackClient", () => {
  it("sends client details Main owns and an empty tag when none is chosen", async () => {
    const { client, request } = clientFor(wireItem);
    await client.submit({ content: "  保存后闪退 ", images: ["AAAA"] });
    expect(request).toHaveBeenCalledWith("POST", "/market/v1/me/feedback", {
      authenticated: true,
      timeoutMs: 60_000,
      body: {
        tag: "",
        content: "保存后闪退",
        images: ["AAAA"],
        client_version: "1.7.9",
        client_platform: "darwin",
        client_device_model: "MacBookPro18,3"
      }
    });
  });

  it("submits even when the hardware model is unavailable", async () => {
    const request = vi.fn<import("./client").FeedbackRequester["request"]>(
      async () => wireItem
    );
    const client = new FeedbackClient(
      { request },
      { version: "1.7.9", platform: "win32" },
      async () => ""
    );
    await expect(
      client.submit({ content: "无法保存", images: [] })
    ).resolves.toMatchObject({ id: "f1" });
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      body: { client_device_model: "", client_version: "1.7.9" }
    });
  });

  it("drops an empty tag and maps status and reply fields", async () => {
    const { client } = clientFor({
      items: [
        wireItem,
        { ...wireItem, id: "f2", tag: "bug", replied_at: null }
      ],
      page: 2,
      page_size: 10,
      total: 12,
      total_pages: 2
    });
    const page = await client.list({ page: 2 });
    expect(page).toMatchObject({ page: 2, pageSize: 10, totalPages: 2 });
    expect(page.items[0]).toMatchObject({
      status: "processing",
      reply: "已排期",
      repliedAt: wireItem.replied_at,
      images: [{ id: "i1", contentType: "image/webp", byteSize: 12 }]
    });
    expect(page.items[0]).not.toHaveProperty("tag");
    expect(page.items[1]).toMatchObject({ tag: "bug" });
    expect(page.items[1]).not.toHaveProperty("repliedAt");
  });

  it("escapes ids in image paths and allows the slower download", async () => {
    const { client, request } = clientFor({
      id: "i/1",
      content_type: "image/png",
      byte_size: 3,
      data: "AAAA"
    });
    await expect(
      client.image({ feedbackId: "f/1", imageId: "i/1" })
    ).resolves.toEqual({ contentType: "image/png", data: "AAAA" });
    expect(request).toHaveBeenCalledWith(
      "GET",
      "/market/v1/me/feedback/f%2F1/images/i%2F1",
      { authenticated: true, timeoutMs: 30_000 }
    );
  });

  it("rejects a status this client does not know", async () => {
    const { client } = clientFor({
      items: [{ ...wireItem, status: "archived" }],
      page: 1,
      page_size: 10,
      total: 1,
      total_pages: 1
    });
    await expect(client.list()).rejects.toBeInstanceOf(MarketplaceClientError);
  });

  it("accepts up to six screenshots and sends all of them", async () => {
    const sixImages = ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE", "FFFF"];
    const { client, request } = clientFor({
      ...wireItem,
      images: sixImages.map((_, index) => ({
        id: `i${index + 1}`,
        content_type: "image/webp",
        byte_size: 3
      }))
    });
    const created = await client.submit({
      content: "六张截图",
      images: sixImages
    });
    expect(request).toHaveBeenCalledWith("POST", "/market/v1/me/feedback", {
      authenticated: true,
      timeoutMs: 60_000,
      body: {
        tag: "",
        content: "六张截图",
        images: sixImages,
        client_version: "1.7.9",
        client_platform: "darwin",
        client_device_model: "MacBookPro18,3"
      }
    });
    expect(created.images).toHaveLength(6);
  });

  it("does not send invalid feedback", async () => {
    const { client, request } = clientFor(wireItem);
    await expect(
      client.submit({ content: "   ", images: [] })
    ).rejects.toThrow();
    await expect(
      client.submit({
        content: "x",
        images: ["a", "b", "c", "d", "e", "f", "g"]
      })
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
