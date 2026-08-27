import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { canonicalizeImageDataUrl, IMAGE_MAX_DIMENSION, IMAGE_OUTPUT_MAX_BYTES, IMAGE_SOURCE_MAX_BYTES } from "@/server/image-ingestion";

const dataUrl = (mime: "image/png" | "image/jpeg" | "image/webp", bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;
const pixels = { create: { width: 8, height: 5, channels: 4 as const, background: { r: 20, g: 100, b: 180, alpha: 0.75 } } };

describe("server image ingestion", () => {
  it("rejects malformed magic-only and trailing polyglot containers", async () => {
    await expect(canonicalizeImageDataUrl(dataUrl("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    const png = await sharp(pixels).png().toBuffer();
    await expect(canonicalizeImageDataUrl(dataUrl("image/png", Buffer.concat([png, Buffer.from("<script>polyglot</script>")])))).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("rejects declared MIME mismatches, malformed base64, remote URLs, and oversized dimensions", async () => {
    const png = await sharp(pixels).png().toBuffer();
    await expect(canonicalizeImageDataUrl(dataUrl("image/jpeg", png))).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(canonicalizeImageDataUrl("data:image/png;base64,AAAAA")).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(canonicalizeImageDataUrl("https://images.example/profile.png")).rejects.toMatchObject({ code: "INVALID_IMAGE", fieldErrors: { imageUrl: [expect.stringMatching(/Remote image URLs/)] } });
    const bombDimension = await sharp({ create: { width: IMAGE_MAX_DIMENSION + 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    await expect(canonicalizeImageDataUrl(dataUrl("image/png", bombDimension))).rejects.toMatchObject({ code: "INVALID_IMAGE", fieldErrors: { imageUrl: [expect.stringMatching(/dimensions/)] } });
  });

  it("rejects source bytes beyond the upload cap before decoding", async () => {
    const oversized = Buffer.alloc(IMAGE_SOURCE_MAX_BYTES + 1);
    await expect(canonicalizeImageDataUrl(dataUrl("image/png", oversized))).rejects.toMatchObject({ code: "INVALID_IMAGE", status: 413 });
  });

  it("auto-orients, strips metadata, and emits deterministic bounded WebP", async () => {
    const jpeg = await sharp({ create: { width: 8, height: 5, channels: 3, background: "#1464b4" } }).jpeg().withMetadata({ orientation: 6, density: 300 }).toBuffer();
    const source = dataUrl("image/jpeg", jpeg);
    const first = await canonicalizeImageDataUrl(source); const second = await canonicalizeImageDataUrl(source);
    expect(first).toBe(second); expect(first.startsWith("data:image/webp;base64,")).toBe(true);
    const output = Buffer.from(first.split(",")[1]!, "base64"); const metadata = await sharp(output).metadata();
    expect(output.length).toBeLessThanOrEqual(IMAGE_OUTPUT_MAX_BYTES);
    expect(metadata).toMatchObject({ format: "webp", width: 5, height: 8 });
    expect(metadata.orientation).toBeUndefined(); expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
  });
});
