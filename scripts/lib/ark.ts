export type ArkConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  maxRetries: number;
};

export type AudioPartType = "audio_url" | "input_audio";

type MediaPart =
  | { type: "video"; url: string }
  | { type: "audio"; url: string; partType: AudioPartType };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "audio_url"; audio_url: { url: string } }
  | { type: "input_audio"; input_audio: { url: string } };

type ChatPayload = {
  model: string;
  messages: Array<{ role: "system" | "user"; content: ContentPart[] | string }>;
  reasoning_effort?: string;
};

export type ArkUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  audioTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
};

type ChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      audio_tokens?: number;
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
};

export function resolveArkConfig(opts: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: string | number;
  maxRetries?: string | number;
}): ArkConfig {
  const apiKey = opts.apiKey ?? Bun.env.ARK_API_KEY;
  if (!apiKey) throw new Error("缺少 ARK_API_KEY");
  return {
    apiKey,
    baseUrl: opts.baseUrl ?? Bun.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
    model: opts.model ?? Bun.env.ARK_MODEL ?? "doubao-seed-1-6-flash-250928",
    reasoningEffort: opts.reasoningEffort ?? Bun.env.ARK_REASONING_EFFORT ?? "minimal",
    timeoutMs: Number(opts.timeoutMs ?? Bun.env.ARK_TIMEOUT_MS ?? "180000"),
    maxRetries: Number(opts.maxRetries ?? Bun.env.ARK_MAX_RETRIES ?? "3"),
  };
}

function buildMediaPart(media: MediaPart): ContentPart {
  if (media.type === "video") return { type: "video_url", video_url: { url: media.url } };
  if (media.partType === "input_audio") return { type: "input_audio", input_audio: { url: media.url } };
  return { type: "audio_url", audio_url: { url: media.url } };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content, null, 2);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return JSON.stringify(part);
      const cand = part as { type?: string; text?: string };
      if (typeof cand.text === "string") return cand.text;
      return cand.type ? `[${cand.type}]` : JSON.stringify(part);
    })
    .join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CallArkInput = {
  config: ArkConfig;
  systemPrompt?: string;
  userPrompt: string;
  media?: MediaPart;
};

export type CallArkResult = {
  text: string;
  logId: string | null;
  responseId: string | null;
  responseModel: string | null;
  usage: ArkUsage;
};

const EMPTY_USAGE: ArkUsage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  audioTokens: null,
  cachedTokens: null,
  reasoningTokens: null,
};

function pickUsage(usage: ChatResponse["usage"]): ArkUsage {
  if (!usage) return EMPTY_USAGE;
  return {
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    audioTokens: usage.prompt_tokens_details?.audio_tokens ?? null,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
  };
}

export async function callArk(input: CallArkInput): Promise<CallArkResult> {
  const endpoint = `${input.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const userContent: ContentPart[] = [{ type: "text", text: input.userPrompt }];
  if (input.media) userContent.push(buildMediaPart(input.media));

  const payload: ChatPayload = {
    model: input.config.model,
    reasoning_effort: input.config.reasoningEffort,
    messages: [
      ...(input.systemPrompt
        ? [{ role: "system" as const, content: input.systemPrompt }]
        : []),
      { role: "user" as const, content: userContent },
    ],
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= input.config.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.config.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const rawText = await response.text();
      const logId = response.headers.get("x-tt-logid");

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < input.config.maxRetries) {
          await sleep(1500 * attempt);
          continue;
        }
        throw new Error(`Ark 请求失败: HTTP ${response.status} ${response.statusText}\n${rawText}`);
      }

      const parsed = JSON.parse(rawText) as ChatResponse;
      const text = extractText(parsed.choices?.[0]?.message?.content).trim();
      return {
        text,
        logId,
        responseId: parsed.id ?? null,
        responseModel: parsed.model ?? null,
        usage: pickUsage(parsed.usage),
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === input.config.maxRetries) break;
      await sleep(1500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
