---
name: 视频转公众号同步发布
description: Turn a local video into a WeChat Official Account draft: understand the video with Doubao-Seed, generate a Chinese article in the user's own style, pick 3-5 visually good matching screenshots, format it in a configurable mdnice/公众号 style, upload images through the user's own WeChat Official Account API credentials, and create a draft in their公众号后台. Use when someone wants a reusable video-to-WeChat publishing workflow without shared or hardcoded API keys.
---

# 视频转公众号同步发布

This public skill packages a reusable flow for taking one local video all the way to a WeChat Official Account draft. It keeps the Doubao multimodal CLI as the video-understanding engine, then adds editorial formatting and WeChat draft creation.

1. Understand/transcribe the video with Doubao-Seed.
2. Generate a first article draft, then rewrite it into the user's requested公众号文风.
3. Select 3-5 screenshots that are visually clean, match the article sections, and avoid awkward faces.
4. Format the article with the user's mdnice/墨滴 style.
5. Upload body images and cover image through the WeChat Official Account API.
6. Create a draft in the公众号后台.

The historical raw multimodal CLI remains available for ASR, timeline extraction, keyframe extraction, and custom video prompts.

## Public Configuration Rule

Never use shared credentials, the skill author's credentials, or credentials from prior conversations. Every user must provide their own API keys through either environment variables or a local `.env` file that is not committed.

Supported local config file:

```bash
cp .env.example .env
```

Then fill in that user's own values.

## Writing And Layout Defaults

Default公众号 style:

- Title and article should be sharp but not clickbait; keep the article under about 3000 Chinese characters unless asked otherwise.
- Start from a concrete observation or tension, then move toward insight.
- Use short paragraphs and clear judgment.
- Adapt to the user's provided writing samples when available; otherwise use a clean, conversational business-analysis style.
- Use 3-5 images only. Each image must match nearby text and look clean enough to publish.
- Default mdnice style: Optima / Microsoft YaHei / PingFang, 16px body text, 1.8 line height, black bold emphasis, and warm quote blocks with orange left border. Customize if the user provides their own mdnice HTML sample.

## WeChat Publishing Requirements

To create a draft through the公众号 API, these environment variables are needed:

```bash
WECHAT_APPID=...
WECHAT_APPSECRET=...
WECHAT_AUTHOR=...
```

The current machine's public IP must be added to:

公众号后台 → 设置与开发 → 基本配置 → IP 白名单

If the API returns `40164 invalid ip`, ask the user to add the IP shown by WeChat and retry.

The Doubao/TOS side also uses the user's own credentials:

```bash
ARK_API_KEY=...
ARK_MODEL=...
TOS_ACCESS_KEY_ID=...
TOS_ACCESS_KEY_SECRET=...
TOS_BUCKET=...
TOS_REGION=...
TOS_ENDPOINT=...
```

## Packaged Workflow Output

For a video named `<video-name>`, write outputs under:

```text
out/<video-name>-视频转公众号同步发布/
  understand.txt/json
  keyframes/keyframe-extract.txt/json
  公众号版/
    公众号文章_用户风格3000字内.md
    images_selected/
    墨滴风格排版/
      公众号排版稿_预览.html
      公众号排版稿_可复制片段.html
      公众号排版稿_公众号图片URL版.html
      公众号后台填写信息.md
      公众号草稿创建结果.json
      images/
  小红书版/
  进度记录.md
```

Use `scripts/wechat_draft.py` after the mdnice HTML is ready to upload images and create the draft.

```bash
python3 {baseDir}/scripts/wechat_draft.py \
  --base-dir "/abs/path/to/墨滴风格排版" \
  --env-file "{baseDir}/.env"
```

The script expects:

- `公众号排版稿_可复制片段.html`
- `公众号后台填写信息.md`
- `images/00_wechat_cover_dialog_900x383.jpg` or another cover file passed with `--cover`

It writes:

- `公众号排版稿_公众号图片URL版.html`
- `公众号草稿创建结果.json`

For public release, keep `.env.example` in the package, but never commit `.env`.

## Doubao Multimodal Understanding Engine

Bun + TypeScript CLI wrapping the Doubao-Seed multimodal chat completion endpoint. Resolves a single audio/video source (URL or local path), normalizes it for Ark (download remote → cache, upload local → TOS pre-signed URL), splits oversized media, fans out concurrent Ark calls, and merges the results.

## Script Directory

`{baseDir}` = this SKILL.md's directory. Main entry: `{baseDir}/scripts/main.ts`. Run with `bun run {baseDir}/scripts/main.ts ...`. Dependencies live in `{baseDir}/scripts/package.json` (run `bun install` inside that folder once).

Public release note: the CLI supports `--env-file /path/to/.env` so each user can keep Ark/TOS credentials in their own local config file.

## Required Environment

```bash
ARK_API_KEY=...                 # 火山方舟 API Key (必填)
ARK_MODEL=...                   # 多模态 endpoint id 或 model 名，例如 doubao-seed-2-0-lite-260428 或 doubao-seed-1-6-flash-250928
ARK_BASE_URL=...                # 可选，默认 https://ark.cn-beijing.volces.com/api/v3
ARK_REASONING_EFFORT=minimal    # 可选

# 上传本地文件时必填（远程 URL 输入则不需要）
TOS_ACCESS_KEY_ID=...
TOS_ACCESS_KEY_SECRET=...
TOS_BUCKET=...
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com   # 可选
TOS_KEY_PREFIX=doubao-multimodal         # 可选
```

> 注意：部分 Doubao-Seed endpoint 仅支持 `input_audio` 字段（不支持 `audio_url`）。命中 400 `invalid value: audio_url` 时，加 `--audio-part-type input_audio`。

## Tasks

| `--task` | 说明 | 视频自动转音频 |
|----------|------|---------------|
| `asr` | 纯文字转写（无标点格式约束） | ✅ |
| `asr-timestamp` | 每字带 `开始-结束-字符;` 模板 | ✅ |
| `multispeaker-asr` | `[spk0]...[spk1]...` 输出 | ✅ |
| `ast` | 语音翻译，配合 `--target-language` | ✅ |
| `diarize` | 说话人日志：`[spk][start-end]文本` | ✅ |
| `subtitle-align` | 已知字幕做字符级打轴，需 `--subtitle*` | ✅ |
| `caption` | 音频/视频整体分析（markdown 报告） | ❌ 视频时保留画面 |
| `video-timeline` | 视频时间轴 JSON：`start_end_time/event/people/emotion`（仅视频） | ❌ 视频时保留画面 |
| `keyframe-extract` | 技术博客配图关键帧 JSON：`timestamp/timestamp_sec/description/suggested_caption/reason`（仅视频，可选 `--transcript*`） | ❌ 视频时保留画面 |
| `understand` | 自定义 prompt 的通用理解，需 `--prompt*` | ❌ 视频时保留画面 |

视频自动转音频 = 当任务只看声音时，CLI 会先用 ffmpeg 抽 16kHz mono WAV，再走音频流程；其余任务保留 `video_url` 直接送给 Ark。

## Source Resolution

- `--url <u>`：远程音视频。CLI 会先下载到 `{out-dir}/cache/downloads/<sha>.<ext>`，确保后续 ffmpeg/上传走本地。
- `--path <p>`：本地音视频。CLI 会上传到 TOS，得到预签名 GET URL 给 Ark。
- 类型推断：先看扩展名，再看远程 `Content-Type`；判定不出来就报错，要求 `--type audio|video`。

## Splitting Rules

| 类型 | 阈值 | 单段限制 |
|------|------|----------|
| 视频 | 时长 > 20 min 或 文件 > 50 MB | ≤ 20 min, ≤ 50 MB |
| 音频 | 时长 > 120 min 或 文件 > 50 MB | ≤ 120 min, ≤ 50 MB |

**视频切片**：先 `ffprobe` 取分辨率，源高度 > 720 时下采样到 720p（`scale=-2:720`，保持宽高比，不上采样）。编码 H.264 veryfast，CRF 28（恒定质量）+ maxrate 1500 kbps / bufsize 3000 kbps（动作画面才会冲到上限，PPT/演讲类内容通常 200-400 kbps）+ AAC @ 96 kbps。初始按 `min(20min, 50MB ÷ 假设均值 496 kbps × 0.9 ≈ 12.4min)` 估算切段，所以一段 21 min 的演讲视频通常切 2 段（实测每段 ~17 MB）。如果某段编码后仍 > 50 MB（高动作内容），**不再降码率**，而是把这段时间二分继续切（`partNNNa / partNNNb / partNNNaa ...`），递归到 ≤ 30 s 兜底。

**音频切片**：H.264 不参与，转 mp3 16k mono @ 48 kbps，超过 50 MB 才会按比例降码率重切（音频码率本就低，降码率对 ASR 影响很小）。

多段时按 `--concurrency`（默认 3）并发送到 Ark，最后按时间顺序拼接 `=== Part N (start-end) ===` 分隔；`Segment.index` 在所有子段拍平后从 0 重新编号。

## ffmpeg

启动时自动检测 `ffmpeg` + `ffprobe`。缺失时给出安装命令（macOS Homebrew / apt / dnf / pacman），**默认会停下来等用户回 `y` 确认**；用 `--yes` 可跳过确认（适合 CI/Skill 自动化场景，仅在已得到用户授权后使用）。

## Quick Start

```bash
# 远程音频 ASR
bun run {baseDir}/scripts/main.ts \
  --task asr \
  --url "https://example.com/clip.wav" --type audio \
  --audio-part-type input_audio \
  --out-dir ./out/asr

# 本地视频 → 自动抽音频 → 多说话人 ASR
bun run {baseDir}/scripts/main.ts \
  --task multispeaker-asr \
  --path "/abs/path/to/meeting.mp4" \
  --audio-part-type input_audio \
  --out-dir ./out/meeting

# 视频整体理解，自定义 prompt
bun run {baseDir}/scripts/main.ts \
  --task understand \
  --path "/abs/path/to/replay.mp4" \
  --prompt "你是 CS2 教练，先描述这一回合的关键事件，再点评经济与道具使用。" \
  --out-dir ./out/cs2-replay

# 视频时间轴 JSON 分析（事件/人物/情绪）
bun run {baseDir}/scripts/main.ts \
  --task video-timeline \
  --url "https://ark-public.tos-cn-beijing.volces.com/carcrash.mp4" --type video \
  --out-dir ./out/timeline

# 为技术博客挑配图关键帧（输出 timestamp + 描述 + 建议图注，自己用 ffmpeg 截图）
bun run {baseDir}/scripts/main.ts \
  --task keyframe-extract \
  --url "https://example.com/talk.mp4" --type video \
  --out-dir ./out/keyframes

# 同上，附带转录稿提升选帧准确度
bun run {baseDir}/scripts/main.ts \
  --task keyframe-extract \
  --path ./talk.mp4 \
  --transcript-file ./talk.transcript.txt \
  --out-dir ./out/keyframes-tx

# AST 翻译成英文
bun run {baseDir}/scripts/main.ts \
  --task ast --url "https://x.com/zh.wav" --type audio \
  --target-language English --audio-part-type input_audio \
  --out-dir ./out/ast

# 字幕打轴（已知文本）
bun run {baseDir}/scripts/main.ts \
  --task subtitle-align --path ./clip.wav \
  --subtitle-file ./clip.txt \
  --audio-part-type input_audio \
  --out-dir ./out/align
```

## Output Layout

```
out-dir/
  <task>.json          # 完整结构：每段 start/end/text + log_id/response_id/usage + usage_total + merged
  <task>.txt           # 仅 merged 文本，便于直接消费
  cache/
    downloads/         # 远程 URL 下载缓存（按 sha 命名）
    audio/             # ffmpeg 抽出的音频（仅 ASR-only 视频任务）
    segments/          # 切片后的音/视频片段
```

`<task>.json` 字段速查：
- `usage_total.{prompt_tokens,completion_tokens,total_tokens,audio_tokens,cached_tokens,reasoning_tokens}`：所有片段累加的 token 数，便于成本核算。
- `segments[i].usage`：单段的同上字段。
- `segments[i].log_id`：来自响应头 `x-tt-logid`，向火山技术支持报问题时必备。
- `segments[i].response_id` / `response_model`：响应体里的 `id` 和实际命中的底层模型名（endpoint 会映射到 `doubao-seed-x-x-xxx`）。

## Custom Prompt 套用模板

`--prompt`/`--prompt-file` 主要给 `understand` 用；其他任务的 system + user prompt 已写死成与官方 demo 一致的版本。需要完全覆盖时，可以再加 `--system-prompt` / `--system-prompt-file`。

`--language` 目前只是给 prompt 留的语言提示位（不少任务模板没用上），如果需要严格指定输出语言，请在 `--prompt` 或 `--system-prompt` 里写清楚。

## Common Pitfalls

- 远程 URL 带签名时，确保过期时间 ≥ Ark 调用预计耗时；CLI 会重新下载到本地，所以原 URL 过期不影响 Ark 调用。
- TOS 凭证错误最常见：`SignatureDoesNotMatch` 大概率是 `TOS_ACCESS_KEY_SECRET` 多/少粘了字符。
- `understand` + 视频时如果你只关心音频，请改用对应 ASR/diarize 任务，否则会浪费 video token。
- 切片是按时长平均切，长程任务（>2h）建议结合任务侧的 chunked-summary 工作流，不要把所有 part 直接喂给后续模型。

## Prompt References (按需加载)

每个 task 的 system / user prompt 原文、示例输出、解析片段、CLI 用法都拆成独立的 reference 文件。**先看这张索引**，命中具体任务再读对应文件，不要一次全读。

| 文件 | Task | 一句话用途 |
|------|------|-----------|
| [`references/asr.md`](references/asr.md) | `asr` | 纯文字 ASR：英文 system 强制只输出转写文本，无标点/格式 |
| [`references/asr-timestamp.md`](references/asr-timestamp.md) | `asr-timestamp` | 字符级时间戳 ASR：`{start}-{end}-{char};` 模板 |
| [`references/multispeaker-asr.md`](references/multispeaker-asr.md) | `multispeaker-asr` | 多说话人 ASR：`[spk0]...[spk1]...` 顺序输出，无时间 |
| [`references/ast.md`](references/ast.md) | `ast` | 语音翻译：`--target-language` 控制目标语种，仅返回译文 |
| [`references/diarize.md`](references/diarize.md) | `diarize` | 说话人日志：`[spkN][start-end]文本`，多说话人 ASR + 时间戳 |
| [`references/subtitle-align.md`](references/subtitle-align.md) | `subtitle-align` | 字幕打轴：已知字幕文本，模型只输出每个字符的时间戳 |
| [`references/caption.md`](references/caption.md) | `caption` | 音/视频整体分析：`### 概述/内容分析/说话人/声音事件/视觉信息` markdown 报告 |
| [`references/video-timeline.md`](references/video-timeline.md) | `video-timeline` | 视频时间轴 JSON：`{timeline_events: [{start_end_time, event, people, emotion}]}` |
| [`references/keyframe-extract.md`](references/keyframe-extract.md) | `keyframe-extract` | 博客配图关键帧 JSON：`{keyframes: [{timestamp, timestamp_sec, description, suggested_caption, reason}]}`，可选 transcript |
| [`references/understand.md`](references/understand.md) | `understand` | 通用理解：user prompt 完全自定义，画面 + 音频共同参与 |

**何时读 reference**：

- 选 task：看上表 + 上面的 `## Tasks` 表就够，不用读文件。
- 写解析代码 / 排查输出格式 / 改 prompt → 读对应 reference。
- 加新 task → 抄一份 reference，更新 `prompts.ts` + `main.ts` 的 task 列表 + 上表。
