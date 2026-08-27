import sharp from "sharp";
import { AppError } from "@/server/errors";

export const IMAGE_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_OUTPUT_MAX_BYTES = 512 * 1024;
export const IMAGE_MAX_DIMENSION = 8192;
export const IMAGE_MAX_PIXELS = 16_000_000;
export const IMAGE_OUTPUT_MAX_DIMENSION = 512;
const DATA_URL_PREFIX_BY_MIME = {
  "image/png": "data:image/png;base64,",
  "image/jpeg": "data:image/jpeg;base64,",
  "image/webp": "data:image/webp;base64,",
} as const;
const MAX_DATA_URL_PREFIX_CHARS = Math.max(...Object.values(DATA_URL_PREFIX_BY_MIME).map((prefix) => prefix.length));
export const IMAGE_DATA_URL_MAX_CHARS = Math.ceil(IMAGE_SOURCE_MAX_BYTES / 3) * 4 + MAX_DATA_URL_PREFIX_CHARS;
export const IMAGE_JSON_BODY_MAX_BYTES = IMAGE_DATA_URL_MAX_CHARS + 8 * 1024;

type SupportedMime = "image/png" | "image/jpeg" | "image/webp";
const formatByMime: Record<SupportedMime, "png" | "jpeg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

function invalidImage(message: string, fieldName: string, status = 422) {
  return new AppError("INVALID_IMAGE", message, status, { [fieldName]: [message] });
}

function strictPngContainer(bytes: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 20 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8; let first = true;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.length || (first && (type !== "IHDR" || length !== 13))) return false;
    first = false;
    if (type === "IEND") return length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function strictJpegContainer(bytes: Buffer) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

function strictWebpContainer(bytes: Buffer) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP" || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32LE(offset + 4); const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) return false;
    offset = end;
  }
  return offset === bytes.length;
}

function containerMatches(mime: SupportedMime, bytes: Buffer) {
  if (mime === "image/png") return strictPngContainer(bytes);
  if (mime === "image/jpeg") return strictJpegContainer(bytes);
  return strictWebpContainer(bytes);
}

function isBase64Code(code: number) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f;
}

function decodeStrictDataUrl(value: string, fieldName: string) {
  if (value.length > IMAGE_DATA_URL_MAX_CHARS) throw invalidImage("Image source must be 5 MB or smaller.", fieldName, 413);
  const mime = (Object.keys(DATA_URL_PREFIX_BY_MIME) as SupportedMime[]).find((candidate) => value.startsWith(DATA_URL_PREFIX_BY_MIME[candidate]));
  if (!mime) throw invalidImage("Upload a valid PNG, JPEG, or WebP data URL.", fieldName);
  const payload = value.slice(DATA_URL_PREFIX_BY_MIME[mime].length);
  if (payload.length === 0 || payload.length % 4 !== 0) throw invalidImage("Image base64 encoding is malformed.", fieldName);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  for (let index = 0; index < payload.length - padding; index += 1) {
    if (!isBase64Code(payload.charCodeAt(index))) throw invalidImage("Image base64 encoding is malformed.", fieldName);
  }
  for (let index = payload.length - padding; index < payload.length; index += 1) {
    if (payload.charCodeAt(index) !== 0x3d) throw invalidImage("Image base64 encoding is malformed.", fieldName);
  }
  const decodedLength = (payload.length / 4) * 3 - padding;
  if (decodedLength > IMAGE_SOURCE_MAX_BYTES) throw invalidImage("Image source must be 5 MB or smaller.", fieldName, 413);
  if (decodedLength === 0) throw invalidImage("Image source must be 5 MB or smaller.", fieldName);
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length !== decodedLength || bytes.toString("base64") !== payload) throw invalidImage("Image base64 encoding is malformed.", fieldName);
  if (!containerMatches(mime, bytes)) throw invalidImage("Image container is malformed or contains trailing data.", fieldName);
  return { mime, bytes };
}

export function isRemoteImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; }
  catch { return false; }
}

export async function canonicalizeImageDataUrl(value: string, fieldName = "imageUrl") {
  if (!value.startsWith("data:")) throw invalidImage("Remote image URLs cannot be saved. Upload the image file instead.", fieldName);
  const { mime, bytes } = decodeStrictDataUrl(value, fieldName);
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: IMAGE_MAX_PIXELS, sequentialRead: true }).metadata();
  } catch {
    throw invalidImage("Image could not be decoded safely.", fieldName);
  }
  if (metadata.format !== formatByMime[mime]) throw invalidImage("Declared image type does not match the decoded image.", fieldName);
  if (!metadata.width || !metadata.height || metadata.width > IMAGE_MAX_DIMENSION || metadata.height > IMAGE_MAX_DIMENSION || metadata.width * metadata.height > IMAGE_MAX_PIXELS) throw invalidImage("Image dimensions are too large.", fieldName);
  if ((metadata.pages ?? 1) !== 1) throw invalidImage("Animated or multi-page images are not supported.", fieldName);

  for (const quality of [82, 70, 56]) {
    try {
      const output = await sharp(bytes, { failOn: "error", limitInputPixels: IMAGE_MAX_PIXELS, sequentialRead: true })
        .rotate()
        .resize({ width: IMAGE_OUTPUT_MAX_DIMENSION, height: IMAGE_OUTPUT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .webp({ quality, alphaQuality: 90, smartSubsample: true, effort: 4 })
        .toBuffer();
      if (output.length <= IMAGE_OUTPUT_MAX_BYTES) return `data:image/webp;base64,${output.toString("base64")}`;
    } catch {
      throw invalidImage("Image could not be decoded safely.", fieldName);
    }
  }
  throw invalidImage("Image could not be reduced to the safe storage limit.", fieldName, 413);
}
