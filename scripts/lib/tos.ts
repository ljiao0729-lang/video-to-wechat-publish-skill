import { basename, extname } from "node:path";

import { TosClient } from "@volcengine/tos-sdk";

import { quoteShellArg, sha256Hex } from "./utils";

export type TosConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  stsToken?: string;
  bucket: string;
  region: string;
  endpoint?: string;
  keyPrefix?: string;
  urlExpiresSec: number;
};

export function resolveTosConfig(opts: {
  tosAccessKeyId?: string;
  tosAccessKeySecret?: string;
  tosStsToken?: string;
  tosBucket?: string;
  tosRegion?: string;
  tosEndpoint?: string;
  tosKeyPrefix?: string;
  tosUrlExpires?: string | number;
}): TosConfig {
  const env = (k: string): string | undefined => {
    const v = Bun.env[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  };
  const accessKeyId = opts.tosAccessKeyId ?? env("TOS_ACCESS_KEY_ID");
  const accessKeySecret = opts.tosAccessKeySecret ?? env("TOS_ACCESS_KEY_SECRET");
  const bucket = opts.tosBucket ?? env("TOS_BUCKET");
  const region = opts.tosRegion ?? env("TOS_REGION");
  const endpoint = opts.tosEndpoint ?? env("TOS_ENDPOINT");
  const stsToken = opts.tosStsToken ?? env("TOS_STS_TOKEN");
  const keyPrefix = opts.tosKeyPrefix ?? env("TOS_KEY_PREFIX") ?? "doubao-multimodal";
  const urlExpiresSec = Number(opts.tosUrlExpires ?? env("TOS_URL_EXPIRES") ?? "86400");

  if (!accessKeyId) throw new Error("缺少 TOS_ACCESS_KEY_ID");
  if (!accessKeySecret) throw new Error("缺少 TOS_ACCESS_KEY_SECRET");
  if (!bucket) throw new Error("缺少 TOS_BUCKET");
  if (!region) throw new Error("缺少 TOS_REGION");
  if (!Number.isFinite(urlExpiresSec) || urlExpiresSec <= 0) {
    throw new Error(`无效的 TOS URL 过期时间: ${opts.tosUrlExpires ?? env("TOS_URL_EXPIRES")}`);
  }

  return { accessKeyId, accessKeySecret, stsToken, bucket, region, endpoint, keyPrefix, urlExpiresSec };
}

function sanitizeSegment(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildObjectKey(localPath: string, keyPrefix?: string): string {
  const safeName = sanitizeSegment(basename(localPath)) || "file.bin";
  const suffix = sha256Hex(`${localPath}:${Date.now()}`).slice(0, 12);
  const datePrefix = new Date().toISOString().slice(0, 10);
  const prefix = keyPrefix?.replace(/^\/+|\/+$/g, "");
  return [prefix, datePrefix, `${suffix}-${safeName}`].filter(Boolean).join("/");
}

function inferContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
  };
  return map[ext] ?? "application/octet-stream";
}

async function curlPut(filePath: string, putUrl: string): Promise<void> {
  const command = [
    "curl",
    "-X",
    "PUT",
    "-T",
    filePath,
    "-H",
    `Content-Type: ${inferContentType(filePath)}`,
    putUrl,
    "-o",
    "/dev/null",
    "-sS",
    "-w",
    "%{http_code}",
  ];
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`curl 上传失败: ${stderrText || stdoutText}`);
  const status = Number(stdoutText.trim());
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new Error(`curl 上传返回异常状态码: ${stdoutText.trim() || "(empty)"} (${quoteShellArg(filePath)})`);
  }
}

export async function uploadToTos(input: {
  config: TosConfig;
  localPath: string;
  objectKey?: string;
}): Promise<{ objectKey: string; signedGetUrl: string }> {
  const client = new TosClient({
    accessKeyId: input.config.accessKeyId,
    accessKeySecret: input.config.accessKeySecret,
    stsToken: input.config.stsToken,
    bucket: input.config.bucket,
    region: input.config.region,
    endpoint: input.config.endpoint,
    requestTimeout: 10 * 60 * 1000,
    connectionTimeout: 30 * 1000,
    maxRetryCount: 3,
  });
  const objectKey = input.objectKey ?? buildObjectKey(input.localPath, input.config.keyPrefix);
  const putUrl = client.getPreSignedUrl({ key: objectKey, method: "PUT", expires: 3600 });
  await curlPut(input.localPath, putUrl);
  const signedGetUrl = client.getPreSignedUrl({
    key: objectKey,
    method: "GET",
    expires: input.config.urlExpiresSec,
  });
  return { objectKey, signedGetUrl };
}
