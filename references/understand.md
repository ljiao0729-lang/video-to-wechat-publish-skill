# Task: `understand` — 通用音/视频理解 + 自定义 Prompt

唯一一个 user prompt 完全由调用方决定的任务。模型同时看画面 + 听声音，回答 `--prompt` 里的具体问题。CS2 教练复盘、英语课堂打分、直播间逼单话术分析等定制化场景都走这条。

## System Prompt（默认）

```
你是音/视频理解专家，擅长结合画面、声音和语音内容回答用户问题。
```

需要换角色（"游戏教练"、"课堂分析师"等）就用 `--system-prompt` / `--system-prompt-file` 覆盖。

## User Prompt

由 `--prompt "<text>"` 或 `--prompt-file <path>` 注入。CLI 不再附加任何模板文字，原样发给 Ark。

如果不传 prompt，会兜底成 `请描述这段媒体的关键信息。`，但这种情况下基本应该改用 `caption`。

## 关键行为

- **保留视频画面**：`audioOnly = false`，所以传视频时 Ark 收到的是 `video_url`，画面 + 音频一起被理解。
- **多段拼接**：每段加自动前缀 `（注：本次输入为整段媒体的 Part N (start-end) 片段，请仅基于本片段内容回答。）`，再附上你的 prompt。这是为了避免模型把片段当成完整素材误推断（例如全片 30min，给它的只是第一段 5min）。
- **无固定输出格式**：解析器请按你 prompt 里规定的格式来。模型可能输出 markdown / JSON / 自由文本，CLI 不做后处理。

## 推荐用法：要结构化输出就在 prompt 里写死格式

```bash
bun run {baseDir}/scripts/main.ts \
  --task understand \
  --path ./replay.mp4 \
  --prompt "你是 CS2 教练。请用 JSON 输出本回合的关键事件，schema：
{
  \"round_summary\": string,
  \"economy\": { \"team_a\": number, \"team_b\": number },
  \"key_kills\": [{\"timestamp\": string, \"player\": string, \"weapon\": string}],
  \"coaching_tips\": [string]
}
不要输出其他内容。" \
  --out-dir ./out/cs2
```

切片场景下，如果 prompt 要求 JSON，记得最终 `merged` 是多段 JSON 的拼接（用 `=== Part N ===` 分隔），后处理需要按段独立 `JSON.parse`，不要直接 parse 整个文件。

## 推荐用法：长视频做"先分段抓事件，再 reducer 总结"

1. 第一遍 `understand` + prompt：每段输出结构化事件列表。
2. 第二遍把所有 `segments[].text` 串起来，喂给一个普通 LLM 做汇总（CLI 不直接做这步）。

## 何时用 `caption` 而不是它

- 想要模型自己挑章节、统一风格 → `caption`
- 想要模型按你的 schema / 角色回答 → `understand`
- 想要纯转写 → `asr` / `multispeaker-asr` / `diarize`

## CLI

```bash
# 视频 + 自定义 system + user prompt
bun run {baseDir}/scripts/main.ts \
  --task understand \
  --path ./class.mp4 \
  --system-prompt-file ./prompts/teacher-coach.system.txt \
  --prompt-file ./prompts/teacher-coach.user.txt \
  --out-dir ./out/class

# 远程音频 + 一行 prompt
bun run {baseDir}/scripts/main.ts \
  --task understand \
  --url "https://example.com/podcast.mp3" --type audio \
  --prompt "用 5 个 bullet 概括这期播客的核心观点，并标注每个观点对应的大致时间区间。" \
  --audio-part-type input_audio \
  --out-dir ./out/podcast
```
