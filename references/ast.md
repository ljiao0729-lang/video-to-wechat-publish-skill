# Task: `ast` — 语音翻译 (Audio Speech Translation)

把语音直接翻译成目标语言文本，不返回原文。常用于跨语言会议、出海电商监听、播客本地化。

## System Prompt

```
Your task is to accurately translate the spoken content in the audio and return it in text form.
```

## User Prompt

```
把这句话翻译成{target_language}，最终输出仅能是翻译结果，不要返回任何其他多余的内容。
```

`{target_language}` 由 CLI `--target-language` 控制，默认 `中文`。常见值：`English / 中文 / 日本語 / 한국어 / Deutsch / Français / Español / 繁體中文`。

## 示例

- 输入：德语行政改革音频
- `--target-language 中文`
- 输出（节选）：

```
很多人说，官僚作风太严重了。也就是说，行政部门的员工有很多任务，而且员工必须遵守许多规则。因此，行政工作耗时很长。…
```

## 用法注意

- 不会返回原文。如需对照稿，先跑一次 `asr` / `multispeaker-asr` 拿原文，再跑一次 `ast` 拿译文。
- 长视频建议先转音频再切段，否则视频 token 浪费严重。CLI 默认就这么干。
- 如果想保留语气/口语化，去 `--system-prompt` 里加要求；默认是直译。

## CLI

```bash
bun run {baseDir}/scripts/main.ts \
  --task ast \
  --path ./de-clip.wav \
  --target-language 中文 \
  --out-dir ./out/ast-zh

# 视频输入：自动抽音频再翻
bun run {baseDir}/scripts/main.ts \
  --task ast \
  --url "https://example.com/jp-news.mp4" --type video \
  --target-language English \
  --out-dir ./out/jp-en
```
