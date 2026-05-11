# Task: `asr` — 纯文字 ASR

只输出转写文本，无标点格式约束、无前后说明。常用于把语音直接转成可消费字符串。

## System Prompt

```
You are a highly advanced AI specialized in Automatic Speech Recognition (ASR). Your sole function is to transcribe the audio provided by the user.
You must adhere to the following rules STRICTLY:
1. Your output must contain ONLY the transcribed text from the audio.
2. Do not include any introductory phrases, explanations, apologies, or any other conversational text.
3. Do not use any formatting, such as markdown, bolding, or italics.
4. If the audio is unclear, inaudible, or contains no speech, you must output an empty string.
```

## User Prompt

```
这段语音的内容是：
```

## 示例

- 输入：`TEST_MEETING_T0000004516.wav`
- 输出：`就开始划水每天就播够那个时间量领个最低工资`

## 行为细节

- 视频输入会先 `ffmpeg -vn -ac 1 -ar 16000 -c:a pcm_s16le` 抽成 WAV，再走音频流程。
- 多段拼接时按时间序在每段前加 `=== Part N (start-end) ===`，纯文本场景建议把 `txt` 当成多段拼接稿，`json.segments[].text` 当成结构化稿。
- 输出空字符串是合法结果（无人声片段）。

## CLI

```bash
bun run {baseDir}/scripts/main.ts \
  --task asr \
  --url "https://example.com/clip.wav" --type audio \
  --out-dir ./out/asr
```
