import { FEEDBACK_IMAGE_MAX_BYTES } from "@deepwrite/contracts/renderer";

export interface FeedbackDraftImage {
  id: string;
  /** WebP bytes as base64, ready to submit. */
  data: string;
  previewUrl: string;
}

/** Tried in order until the image fits; text in screenshots stays readable. */
const COMPRESSION_STEPS = [
  { maxEdge: 1920, quality: 0.85 },
  { maxEdge: 1600, quality: 0.75 },
  { maxEdge: 1280, quality: 0.65 },
  { maxEdge: 1024, quality: 0.5 }
] as const;

function encodeWebp(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number
): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败。"));
    reader.readAsDataURL(blob);
  });
}

export async function compressFeedbackImage(
  source: Blob
): Promise<FeedbackDraftImage> {
  const bitmap = await createImageBitmap(source);
  try {
    for (const { maxEdge, quality } of COMPRESSION_STEPS) {
      const blob = await encodeWebp(bitmap, maxEdge, quality);
      if (
        blob?.type === "image/webp" &&
        blob.size <= FEEDBACK_IMAGE_MAX_BYTES
      ) {
        const previewUrl = await readDataUrl(blob);
        return {
          id: crypto.randomUUID(),
          data: previewUrl.slice(previewUrl.indexOf(",") + 1),
          previewUrl
        };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("图片压缩后仍然过大。");
}

export function base64ToBlob(data: string, contentType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
}

/** Text wins over a picture Word or Excel attaches to the same copy. */
export function pastedImages(data: DataTransfer | null): File[] {
  if (!data || data.getData("text/plain").trim()) return [];
  return Array.from(data.files).filter((file) =>
    file.type.startsWith("image/")
  );
}
