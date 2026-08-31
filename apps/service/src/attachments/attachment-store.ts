import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContextArtifact } from "@vraxis/agent-v";
import { promptAttachmentLimits, type PromptAttachment } from "@vraxis/code-contracts";

const storageIdPattern = /^[0-9a-f-]{36}$/i;
const textualMediaTypes = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-httpd-php",
  "application/x-sh",
  "application/xhtml+xml",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
]);

function importedStorageId(attachment: PromptAttachment): string {
  if (attachment.source !== "imported" || !storageIdPattern.test(attachment.path)) {
    throw new TypeError("Imported attachment reference is invalid.");
  }
  return attachment.path;
}

function validName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 255 || name.includes("/") || name.includes("\\")) {
    throw new TypeError("Choose a file with a valid name.");
  }
  return name;
}

export class AttachmentStore {
  readonly directory: string;

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "attachments");
  }

  async importFile(
    nameValue: string,
    mediaTypeValue: string,
    chunks: AsyncIterable<unknown>,
  ): Promise<PromptAttachment> {
    const name = validName(nameValue);
    const mediaType = mediaTypeValue.trim().slice(0, 255) || "application/octet-stream";
    const buffers: Buffer[] = [];
    let size = 0;
    for await (const chunk of chunks) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.byteLength;
      if (size > promptAttachmentLimits.maximumBytes) {
        throw new TypeError(`Files must be ${Math.floor(promptAttachmentLimits.maximumBytes / 1024 / 1024)} MB or smaller.`);
      }
      buffers.push(buffer);
    }
    const storageId = randomUUID();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.directory, 0o700);
    await writeFile(this.file(storageId), Buffer.concat(buffers), { mode: 0o600, flag: "wx" });
    return {
      id: `imported-file:${storageId}`,
      name,
      path: storageId,
      source: "imported",
      mediaType,
      size,
    };
  }

  async validate(attachment: PromptAttachment): Promise<void> {
    const info = await stat(this.file(importedStorageId(attachment)));
    if (!info.isFile()) throw new TypeError("Imported attachment is unavailable.");
    if (attachment.size !== undefined && info.size !== attachment.size) {
      throw new TypeError("Imported attachment no longer matches the selected file.");
    }
  }

  async artifact(attachment: PromptAttachment): Promise<ContextArtifact> {
    await this.validate(attachment);
    const content = await readFile(this.file(importedStorageId(attachment)));
    const mediaType = attachment.mediaType ?? "application/octet-stream";
    const isText = mediaType.startsWith("text/") || textualMediaTypes.has(mediaType);
    return {
      id: attachment.id,
      uri: `vraxis-attachment:///${attachment.path}/${encodeURIComponent(attachment.name)}`,
      mediaType,
      title: attachment.name,
      content: isText ? content.toString("utf8") : `data:${mediaType};base64,${content.toString("base64")}`,
      metadata: { imported: true, size: content.byteLength },
    };
  }

  async remove(storageId: string): Promise<void> {
    await rm(this.file(storageId), { force: true });
  }

  private file(storageId: string): string {
    if (!storageIdPattern.test(storageId)) throw new TypeError("Imported attachment reference is invalid.");
    return join(this.directory, storageId);
  }
}
