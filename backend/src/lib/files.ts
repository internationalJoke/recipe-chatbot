import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);

export const MAX_FILES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;

export function getUploadDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"));
}

export function validateUpload(file: File) {
  const isImage = IMAGE_TYPES.has(file.type);
  const isText = TEXT_TYPES.has(file.type);

  if (!isImage && !isText) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  }

  const limit = isImage ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  if (file.size > limit) {
    throw new Error(`${file.name} exceeds the ${isImage ? "10 MB" : "1 MB"} limit`);
  }
}

export async function saveUpload(file: File) {
  validateUpload(file);
  const uploadDirectory = getUploadDirectory();
  await mkdir(uploadDirectory, { recursive: true });

  const extension = path.extname(file.name).toLowerCase().slice(0, 12);
  const storedName = `${randomUUID()}${extension}`;
  const absolutePath = path.join(/* turbopackIgnore: true */ uploadDirectory, storedName);
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  return {
    originalName: file.name.slice(0, 255),
    mimeType: file.type,
    fileSize: file.size,
    storagePath: storedName,
  };
}

export async function readUpload(storagePath: string) {
  return readFile(/* turbopackIgnore: true */ path.join(getUploadDirectory(), path.basename(storagePath)));
}

export async function removeUpload(storagePath: string) {
  try {
    await unlink(/* turbopackIgnore: true */ path.join(getUploadDirectory(), path.basename(storagePath)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function isImageMimeType(mimeType: string) {
  return IMAGE_TYPES.has(mimeType);
}

export function isTextMimeType(mimeType: string) {
  return TEXT_TYPES.has(mimeType);
}
