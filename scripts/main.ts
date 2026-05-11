#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { callArk, resolveArkConfig, type ArkUsage, type AudioPartType } from "./lib/ark";
import {
  ensureFfmpegInstalled,
  extractAudioToWav,
  probeDuration,
  splitMedia,
  type Segment,
} from "./lib/ffmpeg";
import {
  TASK_TEMPLATES,
  buildPartHeader,
  listTaskKeys,
  type TaskKey,
} from "./lib/prompts";
import { downloadRemote, resolveKind, type MediaKind } from "./lib/source";
import { resolveTosConfig, uploadToTos } from "./lib/tos";
import { ensureDir, fileSizeBytes, formatSeconds, resolvePathFromCwd, sha256Hex, writeJson } from "./lib/utils";

type CliOptions = {
  url?: string;
  path?: string;
  type?: string;
  task: string;
  prompt?: string;
  promptFile?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  language?: string;
  targetLanguage?: string;
  subtitle?: string;
  subtitleFile?: string;
  transcript?: string;
  transcriptFile?: string;
  outDir: string;
  envFile?: string;
  audioPartType?: string;
  concurrency?: string;
  yes?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: string;
  maxRetries?: string;
  tosAccessKeyId?: string;
  tosAccessKeySecret?: string;
  tosStsToken?: string;
  tosBucket?: string;
  tosRegion?: string;
  tosEndpoint?: string;
  tosKeyPrefix?: string;
  tosUrlExpires?: string;
};

const VIDEO_MAX_DURATION_SEC = 20 * 60;
const VIDEO_MAX_SIZE_MB = 50;
const AUDIO_MAX_DURATION_SEC = 120 * 60;
const AUDIO_MAX_SIZE_MB = 50;

function loadEnvFile(path?: string): void {
  if (!path) return;
  const envPath = resolvePathFromCwd(path);
  const text = readFileSync(envPath, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [keyPart, ...valueParts] = line.split("=");
    const key = keyPart.trim();
    const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && Bun.env[key] === undefined) Bun.env[key] = value;
  }
}

function parseTask(value: string): TaskKey {
  const keys = listTaskKeys();
  if (!keys.includes(value as TaskKey)) {
    throw new Error(`未知 --task ${value}，可选: ${keys.join(", ")}`);
  }
  return value as TaskKey;
}

function parseAudioPartType(value: string | undefined): AudioPartType {
  const v = value ?? Bun.env.ARK_AUDIO_PART_TYPE ?? "audio_url";
  if (v !== "audio_url" && v !== "input_audio") {
    throw new Error(`audio-part-type 只能是 audio_url 或 input_audio，收到: ${v}`);
  }
  return v;
}

function parseExplicitKind(value: string | undefined): MediaKind | undefined {
  if (!value) return undefined;
  if (value !== "audio" && value !== "video") {
    throw new Error(`--type 只能是 audio 或 video，收到: ${value}`);
  }
  return value;
}

async function readPromptOrFile(value: string | undefined, file: string | undefined): Promise<string | undefined> {
  if (value) return value;
  if (file) return await Bun.file(resolvePathFromCwd(file)).text();
  return undefined;
}

async function resolveLocalSource(opts: CliOptions): Promise<{ kind: MediaKind; localPath: string; origin: string }> {
  const explicitKind = parseExplicitKind(opts.type);
  if (opts.path) {
    const resolved = resolvePathFromCwd(opts.path);
    if (!(await Bun.file(resolved).exists())) throw new Error(`本地文件不存在: ${resolved}`);
    const kind = await resolveKind({ path: resolved, explicit: explicitKind });
    return { kind, localPath: resolved, origin: resolved };
  }
  if (opts.url) {
    const kind = await resolveKind({ url: opts.url, explicit: explicitKind });
    const cacheDir = join(resolvePathFromCwd(opts.outDir), "cache", "downloads");
    const localPath = await downloadRemote({ url: opts.url, cacheDir, kind });
    return { kind, localPath, origin: opts.url };
  }
  throw new Error("缺少 --url 或 --path");
}

type Prepared = {
  kind: MediaKind;
  localPath: string;
  segments: Segment[];
  audioPartType: AudioPartType;
};

async function prepareMedia(opts: CliOptions, task: TaskKey): Promise<Prepared> {
  const { kind, localPath } = await resolveLocalSource(opts);
  const audioPartType = parseAudioPartType(opts.audioPartType);
  const template = TASK_TEMPLATES[task];

  if (!template.appliesTo.includes(kind)) {
    throw new Error(
      `任务 ${task} (${template.label}) 仅支持 ${template.appliesTo.join("/")}，当前输入为 ${kind}`
    );
  }

  let workingPath = localPath;
  let workingKind: MediaKind = kind;

  if (kind === "video" && template.audioOnly) {
    console.log("⚙️  当前任务仅需要音频，先用 ffmpeg 抽出音频...");
    const audioPath = join(
      resolvePathFromCwd(opts.outDir),
      "cache",
      "audio",
      `${sha256Hex(localPath).slice(0, 12)}.wav`
    );
    if (!(await Bun.file(audioPath).exists())) {
      await extractAudioToWav({ mediaPath: localPath, outputPath: audioPath });
    }
    workingPath = audioPath;
    workingKind = "audio";
  }

  const totalDuration = await probeDuration(workingPath);
  const totalSizeBytes = await fileSizeBytes(workingPath);
  console.log(
    `媒体信息: ${basename(workingPath)} 时长 ${formatSeconds(totalDuration)}, 大小 ${(totalSizeBytes / (1024 * 1024)).toFixed(1)}MB`
  );

  const segmentsDir = join(resolvePathFromCwd(opts.outDir), "cache", "segments");
  const segments = await splitMedia({
    mediaPath: workingPath,
    kind: workingKind,
    outDir: segmentsDir,
    maxSegmentDurationSec: workingKind === "video" ? VIDEO_MAX_DURATION_SEC : AUDIO_MAX_DURATION_SEC,
    maxSegmentSizeMB: workingKind === "video" ? VIDEO_MAX_SIZE_MB : AUDIO_MAX_SIZE_MB,
    totalDurationSec: totalDuration,
  });

  if (segments.length > 1) {
    console.log(`⚙️  超出限制，已切成 ${segments.length} 段，将并发处理。`);
  }

  return { kind: workingKind, localPath: workingPath, segments, audioPartType };
}

async function uploadSegments(prepared: Prepared, opts: CliOptions): Promise<string[]> {
  const tos = resolveTosConfig(opts);
  const urls: string[] = new Array(prepared.segments.length);
  await Promise.all(
    prepared.segments.map(async (segment, index) => {
      console.log(`⬆️  上传第 ${index + 1}/${prepared.segments.length} 段到 TOS: ${basename(segment.path)}`);
      const result = await uploadToTos({ config: tos, localPath: segment.path });
      urls[index] = result.signedGetUrl;
    })
  );
  return urls;
}

async function processTask(opts: CliOptions): Promise<void> {
  const task = parseTask(opts.task);
  const template = TASK_TEMPLATES[task];
  const arkConfig = resolveArkConfig(opts);

  if (task === "subtitle-align") {
    const subtitleText = await readPromptOrFile(opts.subtitle, opts.subtitleFile);
    if (!subtitleText) throw new Error("subtitle-align 任务必须提供 --subtitle 或 --subtitle-file");
    opts.subtitle = subtitleText;
  }
  const transcriptText = await readPromptOrFile(opts.transcript, opts.transcriptFile);
  if (transcriptText) opts.transcript = transcriptText;
  const customPrompt = await readPromptOrFile(opts.prompt, opts.promptFile);
  if (task === "understand" && !customPrompt) {
    throw new Error("understand 任务必须提供 --prompt 或 --prompt-file");
  }
  const systemOverride = await readPromptOrFile(opts.systemPrompt, opts.systemPromptFile);

  const outDir = resolvePathFromCwd(opts.outDir);
  await ensureDir(outDir);

  await ensureFfmpegInstalled(opts.yes ?? false);
  const prepared = await prepareMedia(opts, task);
  const urls = await uploadSegments(prepared, opts);

  const concurrency = Math.max(1, Number(opts.concurrency ?? "3"));
  const results: Array<{
    index: number;
    segment: Segment;
    text: string;
    logId: string | null;
    responseId: string | null;
    responseModel: string | null;
    usage: ArkUsage;
  }> = [];

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < prepared.segments.length) {
      const idx = cursor++;
      const segment = prepared.segments[idx];
      const partLabel = `${idx + 1}/${prepared.segments.length} (${formatSeconds(segment.startSec)}-${formatSeconds(segment.endSec)})`;
      const baseUserPrompt = template.userPrompt({
        prompt: customPrompt,
        language: opts.language,
        targetLanguage: opts.targetLanguage,
        subtitleText: opts.subtitle,
        transcriptText: opts.transcript,
      });
      const userPrompt =
        prepared.segments.length > 1 ? `${buildPartHeader(partLabel)}${baseUserPrompt}` : baseUserPrompt;

      console.log(`▶️  片段 ${partLabel} 调用 Ark...`);
      const callResult = await callArk({
        config: arkConfig,
        systemPrompt: systemOverride ?? template.systemPrompt,
        userPrompt,
        media: {
          type: prepared.kind,
          url: urls[idx],
          partType: prepared.audioPartType,
        },
      });
      results[idx] = {
        index: idx,
        segment,
        text: callResult.text,
        logId: callResult.logId,
        responseId: callResult.responseId,
        responseModel: callResult.responseModel,
        usage: callResult.usage,
      };
      const usage = callResult.usage;
      const usageStr =
        usage.promptTokens != null && usage.completionTokens != null
          ? ` tokens=${usage.promptTokens}+${usage.completionTokens}` +
            (usage.audioTokens ? ` (audio ${usage.audioTokens})` : "")
          : "";
      console.log(
        `✅ 片段 ${partLabel} 完成` +
          (callResult.logId ? ` logid=${callResult.logId}` : "") +
          usageStr
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, prepared.segments.length) }, () => worker())
  );

  const merged = results
    .sort((a, b) => a.index - b.index)
    .map((r) =>
      prepared.segments.length > 1
        ? `=== Part ${r.index + 1} (${formatSeconds(r.segment.startSec)}-${formatSeconds(r.segment.endSec)}) ===\n${r.text}`
        : r.text
    )
    .join("\n\n");

  const totalUsage = results.reduce(
    (acc, r) => {
      acc.prompt_tokens += r.usage.promptTokens ?? 0;
      acc.completion_tokens += r.usage.completionTokens ?? 0;
      acc.total_tokens += r.usage.totalTokens ?? 0;
      acc.audio_tokens += r.usage.audioTokens ?? 0;
      acc.cached_tokens += r.usage.cachedTokens ?? 0;
      acc.reasoning_tokens += r.usage.reasoningTokens ?? 0;
      return acc;
    },
    {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      audio_tokens: 0,
      cached_tokens: 0,
      reasoning_tokens: 0,
    }
  );

  const resultPayload = {
    task,
    label: template.label,
    model: arkConfig.model,
    kind: prepared.kind,
    duration_sec: prepared.segments.reduce((sum, s) => sum + s.durationSec, 0),
    usage_total: totalUsage,
    segments: results.map((r) => ({
      index: r.index,
      start_sec: r.segment.startSec,
      end_sec: r.segment.endSec,
      duration_sec: r.segment.durationSec,
      size_mb: Number((r.segment.sizeBytes / (1024 * 1024)).toFixed(2)),
      log_id: r.logId,
      response_id: r.responseId,
      response_model: r.responseModel,
      usage: {
        prompt_tokens: r.usage.promptTokens,
        completion_tokens: r.usage.completionTokens,
        total_tokens: r.usage.totalTokens,
        audio_tokens: r.usage.audioTokens,
        cached_tokens: r.usage.cachedTokens,
        reasoning_tokens: r.usage.reasoningTokens,
      },
      text: r.text,
    })),
    merged,
  };

  const jsonPath = join(outDir, `${task}.json`);
  const textPath = join(outDir, `${task}.txt`);
  await writeJson(jsonPath, resultPayload);
  await Bun.write(textPath, `${merged}\n`);
  console.log(`📄 已写入 ${jsonPath}`);
  console.log(`📄 已写入 ${textPath}`);
  console.log(
    `📊 总 tokens: prompt=${totalUsage.prompt_tokens} completion=${totalUsage.completion_tokens} total=${totalUsage.total_tokens}` +
      (totalUsage.audio_tokens ? ` audio=${totalUsage.audio_tokens}` : "") +
      (totalUsage.cached_tokens ? ` cached=${totalUsage.cached_tokens}` : "")
  );
}

const program = new Command();
program
  .name("doubao-multimodal")
  .description("基于 Doubao-Seed 的音视频多模态理解 CLI（ASR / AST / Diarize / Caption / 自定义）")
  .showHelpAfterError();

program
  .requiredOption(
    "--task <task>",
    `任务类型，可选: ${listTaskKeys().join(", ")}`
  )
  .option("--url <url>", "远程音频或视频 URL（会先下载到本地缓存）")
  .option("--path <path>", "本地音频或视频路径（会上传到 TOS 取得可签名 URL）")
  .option("--type <audio|video>", "媒体类型；当扩展名/Content-Type 无法判断时必填")
  .option("--prompt <text>", "自定义 prompt（用于 understand 任务，或拼接到模板）")
  .option("--prompt-file <path>", "从文件读取 prompt 内容")
  .option("--system-prompt <text>", "覆盖默认 system prompt")
  .option("--system-prompt-file <path>", "从文件读取 system prompt")
  .option("--language <lang>", "已知语言提示，例如 zh / en")
  .option("--target-language <lang>", "AST 目标语言，默认 中文")
  .option("--subtitle <text>", "subtitle-align 任务的字幕文本")
  .option("--subtitle-file <path>", "从文件读取 subtitle 文本")
  .option("--transcript <text>", "keyframe-extract 任务的可选转录稿，作为定位关键帧的参考")
  .option("--transcript-file <path>", "从文件读取 transcript 文本")
  .requiredOption("--out-dir <path>", "输出目录")
  .option("--env-file <path>", "读取本地 .env 配置文件（不会覆盖已存在的环境变量）")
  .option("--audio-part-type <type>", "Ark 音频字段：audio_url 或 input_audio")
  .option("--concurrency <n>", "切片并发数", "3")
  .option("--yes", "ffmpeg 缺失时跳过确认直接安装")
  .option("--api-key <key>", "Ark API Key（默认读 ARK_API_KEY）")
  .option("--base-url <url>", "Ark Base URL")
  .option("--model <model>", "Ark endpoint/model id")
  .option("--reasoning-effort <level>", "Ark reasoning_effort")
  .option("--timeout-ms <ms>", "单次请求超时时间")
  .option("--max-retries <count>", "重试次数")
  .option("--tos-access-key-id <id>", "TOS AccessKeyId")
  .option("--tos-access-key-secret <secret>", "TOS AccessKeySecret")
  .option("--tos-sts-token <token>", "TOS STS Token")
  .option("--tos-bucket <bucket>", "TOS Bucket")
  .option("--tos-region <region>", "TOS Region")
  .option("--tos-endpoint <endpoint>", "TOS Endpoint")
  .option("--tos-key-prefix <prefix>", "TOS 对象名前缀")
  .option("--tos-url-expires <seconds>", "预签名 GET URL 有效期（秒）")
  .action(async (options: CliOptions) => {
    try {
      loadEnvFile(options.envFile);
      await processTask(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

await program.parseAsync(Bun.argv);
