import { basename, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline/promises";

import { bytesToMB, ensureDir, fileSizeBytes, quoteShellArg } from "./utils";

export type Segment = {
  index: number;
  path: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  sizeBytes: number;
};

async function runCommand(command: string[], label: string): Promise<string> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${label} 失败: ${stderrText || stdoutText}`);
  return stdoutText.trim();
}

async function commandExists(name: string): Promise<boolean> {
  try {
    await runCommand(["which", name], `which ${name}`);
    return true;
  } catch {
    return false;
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function ensureFfmpegInstalled(autoInstall = false): Promise<void> {
  if ((await commandExists("ffmpeg")) && (await commandExists("ffprobe"))) return;

  console.warn("⚠️  未检测到 ffmpeg / ffprobe。");
  const platform = process.platform;
  let command: string[] | null = null;
  if (platform === "darwin" && (await commandExists("brew"))) {
    command = ["brew", "install", "ffmpeg"];
  } else if (platform === "linux") {
    if (await commandExists("apt-get")) command = ["sudo", "apt-get", "install", "-y", "ffmpeg"];
    else if (await commandExists("dnf")) command = ["sudo", "dnf", "install", "-y", "ffmpeg"];
    else if (await commandExists("pacman")) command = ["sudo", "pacman", "-S", "--noconfirm", "ffmpeg"];
  }

  if (!command) {
    throw new Error("无法自动安装 ffmpeg，请手动安装后重试。macOS: brew install ffmpeg");
  }

  const display = command.map(quoteShellArg).join(" ");
  const approved = autoInstall || (await promptYesNo(`是否执行 \`${display}\` 来安装 ffmpeg？`));
  if (!approved) throw new Error("已取消安装。请手动安装 ffmpeg 后重试。");

  console.log(`正在执行: ${display}`);
  const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error("ffmpeg 安装失败，请手动安装后重试。");
  if (!(await commandExists("ffmpeg")) || !(await commandExists("ffprobe"))) {
    throw new Error("ffmpeg 安装后仍不可用，请检查 PATH。");
  }
}

export async function probeDuration(mediaPath: string): Promise<number> {
  const output = await runCommand(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ],
    "ffprobe"
  );
  const value = Number(output);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`无法读取媒体时长: ${mediaPath}`);
  return value;
}

export async function probeVideoHeight(mediaPath: string): Promise<number | null> {
  try {
    const output = await runCommand(
      [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=height",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        mediaPath,
      ],
      "ffprobe height"
    );
    const value = Number(output);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function extractAudioToWav(input: {
  mediaPath: string;
  outputPath: string;
}): Promise<string> {
  await ensureDir(dirname(input.outputPath));
  await runCommand(
    [
      "ffmpeg",
      "-y",
      "-i",
      input.mediaPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      input.outputPath,
    ],
    "ffmpeg 抽音频"
  );
  return input.outputPath;
}

export async function transcodeAudioCompressed(input: {
  mediaPath: string;
  outputPath: string;
  bitrateKbps?: number;
}): Promise<string> {
  await ensureDir(dirname(input.outputPath));
  const bitrate = input.bitrateKbps ?? 48;
  await runCommand(
    [
      "ffmpeg",
      "-y",
      "-i",
      input.mediaPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${bitrate}k`,
      input.outputPath,
    ],
    "ffmpeg 转 mp3"
  );
  return input.outputPath;
}

const DEFAULT_VIDEO_MAX_HEIGHT = 720;
const DEFAULT_VIDEO_CRF = 28;
const DEFAULT_VIDEO_MAXRATE_KBPS = 1500;
const DEFAULT_VIDEO_BUFSIZE_KBPS = 3000;
const DEFAULT_VIDEO_AUDIO_BITRATE_KBPS = 96;
const ASSUMED_VIDEO_AVG_KBPS = 400;
const MIN_VIDEO_SUB_SEGMENT_SEC = 30;

async function copyOrTranscodeSegment(input: {
  mediaPath: string;
  startSec: number;
  durationSec: number;
  outputPath: string;
  kind: "audio" | "video";
  videoCrf?: number;
  videoMaxrateKbps?: number;
  videoBufsizeKbps?: number;
  audioBitrateKbps?: number;
  maxHeight?: number | null;
}): Promise<void> {
  await ensureDir(dirname(input.outputPath));
  const base = [
    "ffmpeg",
    "-y",
    "-ss",
    `${input.startSec}`,
    "-i",
    input.mediaPath,
    "-t",
    `${input.durationSec}`,
  ];
  const videoFilter =
    input.maxHeight && input.maxHeight > 0 ? ["-vf", `scale=-2:${input.maxHeight}`] : [];
  const tail = input.kind === "video"
    ? [
        ...videoFilter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        `${input.videoCrf ?? DEFAULT_VIDEO_CRF}`,
        "-maxrate",
        `${input.videoMaxrateKbps ?? DEFAULT_VIDEO_MAXRATE_KBPS}k`,
        "-bufsize",
        `${input.videoBufsizeKbps ?? DEFAULT_VIDEO_BUFSIZE_KBPS}k`,
        "-c:a",
        "aac",
        "-b:a",
        `${input.audioBitrateKbps ?? DEFAULT_VIDEO_AUDIO_BITRATE_KBPS}k`,
        "-movflags",
        "+faststart",
        input.outputPath,
      ]
    : [
        "-c:a",
        "libmp3lame",
        "-b:a",
        `${input.audioBitrateKbps ?? 48}k`,
        "-ac",
        "1",
        "-ar",
        "16000",
        input.outputPath,
      ];
  await runCommand([...base, ...tail], `ffmpeg 切片 (${input.kind})`);
}

type SubSegment = {
  path: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  sizeBytes: number;
};

async function encodeVideoRangeWithSplit(args: {
  mediaPath: string;
  startSec: number;
  durationSec: number;
  outDir: string;
  baseName: string;
  pathToken: string;
  maxSizeMB: number;
  maxHeight: number | null;
}): Promise<SubSegment[]> {
  const segmentPath = join(args.outDir, `${args.baseName}.${args.pathToken}.mp4`);
  await copyOrTranscodeSegment({
    mediaPath: args.mediaPath,
    startSec: args.startSec,
    durationSec: args.durationSec,
    outputPath: segmentPath,
    kind: "video",
    maxHeight: args.maxHeight,
  });
  const sizeBytes = await fileSizeBytes(segmentPath);
  const sizeMB = bytesToMB(sizeBytes);

  if (sizeMB <= args.maxSizeMB) {
    return [
      {
        path: segmentPath,
        startSec: args.startSec,
        endSec: args.startSec + args.durationSec,
        durationSec: args.durationSec,
        sizeBytes,
      },
    ];
  }

  if (args.durationSec <= MIN_VIDEO_SUB_SEGMENT_SEC) {
    console.warn(
      `⚠️  片段 ${args.startSec.toFixed(1)}-${(args.startSec + args.durationSec).toFixed(1)}s 已拆到 ${args.durationSec.toFixed(1)}s 仍 ${sizeMB.toFixed(1)}MB > ${args.maxSizeMB}MB，按原样上传`
    );
    return [
      {
        path: segmentPath,
        startSec: args.startSec,
        endSec: args.startSec + args.durationSec,
        durationSec: args.durationSec,
        sizeBytes,
      },
    ];
  }

  await Bun.file(segmentPath).delete();
  console.warn(
    `⚠️  片段 ${args.startSec.toFixed(1)}-${(args.startSec + args.durationSec).toFixed(1)}s 经 ${args.maxHeight ?? "原"}p 编码后 ${sizeMB.toFixed(1)}MB > ${args.maxSizeMB}MB，按时间二分继续拆`
  );
  const half = args.durationSec / 2;
  const left = await encodeVideoRangeWithSplit({
    ...args,
    durationSec: half,
    pathToken: `${args.pathToken}a`,
  });
  const right = await encodeVideoRangeWithSplit({
    ...args,
    startSec: args.startSec + half,
    durationSec: args.durationSec - half,
    pathToken: `${args.pathToken}b`,
  });
  return [...left, ...right];
}

function estimateSafeVideoSegmentSec(maxSizeMB: number): number {
  const totalKbps = ASSUMED_VIDEO_AVG_KBPS + DEFAULT_VIDEO_AUDIO_BITRATE_KBPS;
  const targetBytes = maxSizeMB * 1024 * 1024 * 0.9;
  return Math.max(MIN_VIDEO_SUB_SEGMENT_SEC, Math.floor(targetBytes / ((totalKbps * 1024) / 8)));
}

function withSuffix(path: string, suffix: string): string {
  const ext = extname(path);
  const stem = basename(path, ext);
  return join(dirname(path), `${stem}${suffix}${ext}`);
}

export async function splitMedia(input: {
  mediaPath: string;
  kind: "audio" | "video";
  outDir: string;
  maxSegmentDurationSec: number;
  maxSegmentSizeMB: number;
  totalDurationSec?: number;
}): Promise<Segment[]> {
  const totalDuration = input.totalDurationSec ?? (await probeDuration(input.mediaPath));
  const totalSize = await fileSizeBytes(input.mediaPath);
  const totalSizeMB = bytesToMB(totalSize);

  if (totalDuration <= input.maxSegmentDurationSec && totalSizeMB <= input.maxSegmentSizeMB) {
    return [
      {
        index: 0,
        path: input.mediaPath,
        startSec: 0,
        endSec: totalDuration,
        durationSec: totalDuration,
        sizeBytes: totalSize,
      },
    ];
  }

  await ensureDir(input.outDir);
  const baseName = basename(input.mediaPath, extname(input.mediaPath));

  if (input.kind === "video") {
    const inputHeight = await probeVideoHeight(input.mediaPath);
    const maxHeight =
      inputHeight && inputHeight > DEFAULT_VIDEO_MAX_HEIGHT ? DEFAULT_VIDEO_MAX_HEIGHT : null;
    if (maxHeight) {
      console.log(`视频源 ${inputHeight}p，将下采样至 ${maxHeight}p 后再切片`);
    } else if (inputHeight) {
      console.log(`视频源 ${inputHeight}p ≤ ${DEFAULT_VIDEO_MAX_HEIGHT}p，按原分辨率切片`);
    }

    const safeBySize = estimateSafeVideoSegmentSec(input.maxSegmentSizeMB);
    const targetSegmentSec = Math.min(input.maxSegmentDurationSec, safeBySize);
    const segmentCount = Math.max(1, Math.ceil(totalDuration / targetSegmentSec));
    const segmentDuration = Math.ceil(totalDuration / segmentCount);

    const allSubs: SubSegment[] = [];
    for (let i = 0; i < segmentCount; i += 1) {
      const startSec = i * segmentDuration;
      if (startSec >= totalDuration) break;
      const durationSec = Math.min(segmentDuration, totalDuration - startSec);
      const subs = await encodeVideoRangeWithSplit({
        mediaPath: input.mediaPath,
        startSec,
        durationSec,
        outDir: input.outDir,
        baseName,
        pathToken: `part${String(i + 1).padStart(3, "0")}`,
        maxSizeMB: input.maxSegmentSizeMB,
        maxHeight,
      });
      allSubs.push(...subs);
    }
    return allSubs.map((s, index) => ({ index, ...s }));
  }

  const segmentsByDuration = Math.ceil(totalDuration / input.maxSegmentDurationSec);
  const segmentsBySize = Math.ceil(totalSizeMB / input.maxSegmentSizeMB);
  const segmentCount = Math.max(segmentsByDuration, segmentsBySize, 2);
  const segmentDuration = Math.ceil(totalDuration / segmentCount);

  const segments: Segment[] = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const startSec = i * segmentDuration;
    if (startSec >= totalDuration) break;
    const durationSec = Math.min(segmentDuration, totalDuration - startSec);
    const segmentPath = join(
      input.outDir,
      `${baseName}.part${String(i + 1).padStart(3, "0")}.mp3`
    );

    await copyOrTranscodeSegment({
      mediaPath: input.mediaPath,
      startSec,
      durationSec,
      outputPath: segmentPath,
      kind: "audio",
    });

    let sizeBytes = await fileSizeBytes(segmentPath);
    let sizeMB = bytesToMB(sizeBytes);

    if (sizeMB > input.maxSegmentSizeMB) {
      const compressedPath = withSuffix(segmentPath, "-low");
      const targetBitrate = Math.max(
        16,
        Math.floor(((input.maxSegmentSizeMB * 0.9 * 8 * 1024) / durationSec) | 0)
      );
      console.warn(
        `第 ${i + 1} 段 ${sizeMB.toFixed(1)}MB 超过 ${input.maxSegmentSizeMB}MB，重新压缩到 ~${targetBitrate}kbps...`
      );
      await copyOrTranscodeSegment({
        mediaPath: input.mediaPath,
        startSec,
        durationSec,
        outputPath: compressedPath,
        kind: "audio",
        audioBitrateKbps: Math.max(24, Math.min(64, targetBitrate)),
      });
      await Bun.file(segmentPath).delete();
      await Bun.write(segmentPath, Bun.file(compressedPath));
      await Bun.file(compressedPath).delete();
      sizeBytes = await fileSizeBytes(segmentPath);
      sizeMB = bytesToMB(sizeBytes);
    }

    segments.push({
      index: i,
      path: segmentPath,
      startSec,
      endSec: startSec + durationSec,
      durationSec,
      sizeBytes,
    });
  }

  return segments;
}
