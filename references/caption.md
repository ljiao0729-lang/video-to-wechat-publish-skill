# Task: `caption` — 音/视频整体分析

输出 markdown 结构化报告：概述 + 内容分析 + 说话人 + 声音事件 + 视觉信息。适合素材入库、节目摘要、内容审核打底。

## System Prompt

```
你是一位资深音频/视频描述专家，听觉灵敏、逻辑严谨、有良好的文学创作素养和通感能力，擅长听音/看图写描述。
```

## User Prompt

```
请按照以下 markdown 格式整体描述这段媒体：
### 概述
整体概述其物理属性（时长、音色音量、清晰度等）、核心内容构成与整体感受。
### 内容分析
概括对话或独白的主要发展，给出标题与摘要。
### 说话人信息（如有）
对说话部分进行说话人语音特征分析。
### 声音事件信息
对非言语部分进行声学特征分析。
### 视觉信息（如视频）
对画面关键场景、字幕、人物动作进行描述。
```

## 关键行为

- **不会自动转音频**：视频任务保留 `video_url`，画面也参与分析。如果只想要音频侧分析，传 `--type audio` 或先抽好 wav。
- 输出是带 `###` 的 markdown，后续可以直接 `grep '^###'` 拿章节。
- 结构由 prompt 写死。要换章节（比如加"营销洞察"），用 `--system-prompt`/`--prompt` 自定义。

## 示例片段

```
### 概述
这是一段约10分钟的真实场景录音，核心参与者为多名男性，整体音量随事件发展有明显起伏，背景持续的人群嘈杂声较大，部分对话清晰度受限。…
### 内容分析
话题1：婚礼仪式主持
…
### 声音事件信息
事件总结：音频全程伴随着密集的人群交谈声和欢笑声…
```

## 多段拼接

长视频会被切成多段，每段独立产出 markdown 报告，最终 `merged` 之间用 `=== Part N (start-end) ===` 分隔。需要全程总结时，把 `segments[].text` 喂给一个 reducer LLM 做二次汇总，不要直接当成稿件。

## CLI

```bash
# 视频整体分析（保留画面）
bun run {baseDir}/scripts/main.ts \
  --task caption \
  --path ./episode.mp4 \
  --out-dir ./out/caption

# 只分析声音
bun run {baseDir}/scripts/main.ts \
  --task caption \
  --url "https://example.com/scene.wav" --type audio \
  --out-dir ./out/audio-caption
```
