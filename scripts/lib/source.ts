import { extname, join } from "node:path";

import { ensureDir, sha256Hex } from "./utils";

export type MediaKind = "audio" | "video";

export type ResolvedSource = {
  kind: MediaKind;
  localPath: string;
  origin: { type: "url" | "path"; value: string };
};

const audioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav"]);
const videoExtensions = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm"]);

export function inferKindFromExtension(value: string): MediaKind | undefined {
  let ext = extname(value).toLowerCase();
  try {
    ext = extname(new URL(value).pathname).toLowerCase() || ext;
  } catch {
    /* local path */
  }
  if (audioExtensions.has(ext)) return "audio";
  if (videoExtensions.has(ext)) return "video";
  return undefined;
}

async function inferKindFromHttp(url: string): Promise<MediaKind | undefined> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    const ct = head.headers.get("content-type")?.toLowerCase();
    if (ct?.startsWith("audio/")) return "audio";
    if (ct?.startsWith("video/")) return "video";
  } catch {
    /* ignore */
  }
  return undefined;
}

function safeExtensionFromUrl(url: string, kind: MediaKind): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (fromUrl) return fromUrl;
  return kind === "video" ? ".mp4" : ".mp3";
}

export async function downloadRemote(input: {
  url: string;
  cacheDir: string;
  kind: MediaKind;
}): Promise<string> {
  await ensureDir(input.cacheDir);
  const cacheKey = sha256Hex(input.url);
  const ext = safeExtensionFromUrl(input.url, input.kind);
  const target = join(input.cacheDir, `${cacheKey}${ext}`);
  if (await Bun.file(target).exists()) return target;

  console.log(`下载远程媒体: ${input.url}`);
  const response = await fetch(input.url);
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
  await Bun.write(target, response);
  return target;
}

export async function resolveKind(input: {
  url?: string;
  path?: string;
  explicit?: MediaKind;
}): Promise<MediaKind> {
  if (input.explicit) return input.explicit;
  const value = input.url ?? input.path;
  if (!value) throw new Error("缺少 --url/--path");
  const fromExt = inferKindFromExtension(value);
  if (fromExt) return fromExt;
  if (input.url) {
    const fromHead = await inferKindFromHttp(input.url);
    if (fromHead) return fromHead;
  }
  throw new Error("无法判断媒体类型，请显式传入 --type audio 或 --type video。");
}
