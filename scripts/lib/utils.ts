import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function resolvePathFromCwd(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

export function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function fileSizeBytes(path: string): Promise<number> {
  const file = Bun.file(path);
  if (!(await file.exists())) return 0;
  return file.size;
}

export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function formatSeconds(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
