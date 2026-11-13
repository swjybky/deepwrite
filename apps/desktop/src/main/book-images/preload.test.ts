import { describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import { bookImages } from "../../preload/book-images-api";
import { isForbiddenRendererCommand } from "../ipc/forbidden-commands";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: { invoke } }));
describe("book image preload boundary", () => {
  it("validates input before invoking Main", async () => {
    invoke.mockClear();
    await expect(
      bookImages.pick({
        book: { projectType: "material", projectId: "bad" }
      } as never)
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("validates returned references and does not expose Core file commands", async () => {
    invoke.mockImplementation(async (_channel, command) => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        status: "saved",
        images: [{ path: "/private/file.png", alt: "bad" }],
        rejected: []
      }
    }));
    await expect(
      bookImages.pick({
        book: { projectType: "short", projectId: "book_test" }
      })
    ).rejects.toThrow();
    expect(isForbiddenRendererCommand("bookImages.write")).toBe(true);
    expect(isForbiddenRendererCommand("bookImages.resolve")).toBe(true);
    expect(isForbiddenRendererCommand("bookImages.pick")).toBe(false);
  });
  it("sends the validated public command with book scope", async () => {
    invoke.mockImplementation(async (_channel, command) => ({
      status: "accepted",
      requestId: command.id,
      payload: { status: "cancelled" }
    }));
    expect(
      await bookImages.pick({
        book: { projectType: "long", projectId: "book_test" }
      })
    ).toEqual({ status: "cancelled" });
    expect(invoke.mock.lastCall?.[1]).toMatchObject({
      ...createEnvelope(
        "bookImages.pick",
        { book: { projectType: "long", projectId: "book_test" } },
        {
          id: invoke.mock.lastCall?.[1].id,
          correlationId: invoke.mock.lastCall?.[1].id,
          context: { resourceId: "book_test" }
        }
      ),
      // The envelope is stamped when sent; only its shape is under test.
      timestamp: expect.any(String)
    });
  });
});
