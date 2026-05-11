# Task: `diarize` — 说话人日志 (Speaker Diarization + ASR)

每句话同时带说话人编号和精确时间区间。是 `multispeaker-asr` + 时间戳的组合，适合做剪辑、字幕轴、可定位检索。

## System Prompt

```
你是一位顶尖的音频分析专家，能够精准地识别出每一位说话者，并为他们说的话标注精确的时间点。
```

## User Prompt

```
这是一段多人说话的语音，你需要识别说话内容，标记每句话对应的说话人并且标记每句话的开始时间和结束时间。对话中出现的第一个人用[spk0]表示，第二个人用[spk1]表示，以此类推。每句话先标记说话人，再标记开始时间和结束时间，最后输出内容，格式: [spk0][开始时间-结束时间]说话内容。
要注意开始时间和结束时间的单位为秒，可以精确到小数点后两位。
注意你只能按着模板输出结果，请勿输出其它无关的信息和内容。
```

## 示例输出

```
[spk0][0.67-8.73]哎呀妈怎么找不着了呢哎呀我妈我东西呢醉了怎么找不着了呢[spk1][8.82-9.66]不是你找啥呢[spk0][9.68-15.48]我找东西呢还是没有这一天呀我这真闹心
```

## 解析

模板 `[spkN][start-end]文本`：

```ts
const utts = [...result.matchAll(/\[(spk\d+)\]\[([\d.]+)-([\d.]+)\]([^\[]*)/g)].map(m => ({
  speaker: m[1],
  start: Number(m[2]),
  end: Number(m[3]),
  text: m[4].trim(),
}));
```

## 多段拼接

每段 Ark 调用看到的是该段相对零点的时间。还原全局时间：`globalStart = utt.start + segments[N].start_sec`。

## 何时用它

- 字幕生成、视频剪辑、可定位回放 → `diarize`
- 不需要时间，只要顺序对话 → `multispeaker-asr`
- 已有字幕文本要打轴 → `subtitle-align`

## CLI

```bash
bun run {baseDir}/scripts/main.ts \
  --task diarize \
  --path ./meeting.mp4 \
  --out-dir ./out/diarize
```
