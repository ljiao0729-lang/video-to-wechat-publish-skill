# Task: `multispeaker-asr` — 多说话人 ASR

按说话人编号 `[spkN]` 顺序输出对话，不带时间戳。适合会议、对谈、客服对话整理。

## User Prompt

```
下面是一段多人说话的语音，你需要识别说话内容并标记每句话对应的说话人。对话中出现的第一个人用[spk0]表示，第二个人用[spk1]表示，以此类推。请顺序输出说话人编号以及语音内容。
```

> System prompt 留空，模板自带的角色设定够用。

## 示例输出

```
[spk0]现在一切都水落石出了。[spk1]什么？什么叫被偷走了？被谁？
```

## 解析

模板 `[spkN]文本[spkM]文本...`，简单切：

```ts
const turns = [...result.matchAll(/\[(spk\d+)\]([^\[]*)/g)].map(m => ({
  speaker: m[1],
  text: m[2].trim(),
}));
```

## 何时用 `diarize` 而不是它

- 只要顺序对话稿 → `multispeaker-asr`
- 需要每句的精确时间区间（剪辑、字幕轴、查谁在某秒说了什么）→ `diarize`

## CLI

```bash
bun run {baseDir}/scripts/main.ts \
  --task multispeaker-asr \
  --path ./conference.mp4 \
  --out-dir ./out/conference
```

视频输入会先抽音频，再走多说话人 ASR。
