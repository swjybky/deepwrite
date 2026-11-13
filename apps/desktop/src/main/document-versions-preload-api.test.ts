import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ListDocumentVersionsInput,
  RestoreDocumentVersionInput
} from "@deepwrite/contracts";

vi.mock("../preload/invoke", () => ({
  browserId: (prefix: string) => `${prefix}_test`,
  invokeCommand: vi.fn()
}));
import { invokeCommand } from "../preload/invoke";
import { versions } from "../preload/document-versions-api";

const target = {
  workspace: "catalog",
  bookId: "book-a",
  documentId: "draft"
} as const;
const current = { sha256: "a".repeat(64), charCount: 4 };
const version = {
  id: "v1-1234abcd",
  seq: 1,
  kind: "pre_conversation",
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  ...current
};
const mockedInvoke = vi.mocked(invokeCommand);

describe("document versions Preload API", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("validates targets and restore hashes before IPC", async () => {
    await expect(
      versions.list({
        target: { workspace: "catalog", bookId: "book-a" }
      } as ListDocumentVersionsInput)
    ).rejects.toThrow();
    await expect(
      versions.restore({
        target,
        versionId: "v1-1234abcd",
        expectedCurrentSha256: "invalid"
      } as RestoreDocumentVersionInput)
    ).rejects.toThrow();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("routes validated requests through the Envelope and validates replies", async () => {
    mockedInvoke.mockResolvedValueOnce({ versions: [version], current });
    await expect(versions.list({ target })).resolves.toEqual({
      versions: [version],
      current
    });
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "versions.list",
        payload: { target },
        context: expect.objectContaining({ resourceId: "book-a" })
      })
    );
    mockedInvoke.mockResolvedValueOnce({ version, content: "text" });
    await expect(
      versions.read({ target, versionId: version.id })
    ).resolves.toEqual({ version, content: "text" });
    mockedInvoke.mockResolvedValueOnce({
      workspace: "catalog",
      version: null,
      current,
      document: {
        id: "draft",
        title: "正文",
        content: "text",
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        projectRevision: 2
      }
    });
    await expect(
      versions.restore({
        target,
        versionId: version.id,
        expectedCurrentSha256: current.sha256
      })
    ).resolves.toMatchObject({
      workspace: "catalog",
      version: null,
      document: { content: "text" }
    });
    for (const method of [
      () => versions.list({ target }),
      () => versions.read({ target, versionId: version.id }),
      () =>
        versions.restore({
          target,
          versionId: version.id,
          expectedCurrentSha256: current.sha256
        })
    ]) {
      mockedInvoke.mockResolvedValueOnce({});
      await expect(method()).rejects.toThrow();
    }
  });
});
