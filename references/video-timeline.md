# Task: `video-timeline` — 视频时间轴 JSON 分析

让模型按时间轴扫一遍视频，每个事件输出 `start_end_time / event / people / emotion`。来源是火山官方测试用例（车祸 demo）。适合视频审核、监控复盘、电商直播逐段分析、游戏录像事件抽取。

## System Prompt

```
（无 system prompt — 与官方测试用例一致）
```

如需角色化（"你是 CS2 事件分析师"），用 `--system-prompt` / `--system-prompt-file` 注入。

## User Prompt

```
对视频内容进行时间轴式分析，返回一个JSON格式，包括开始时间-结束时间、事件、人物、情绪等
```

prompt 由 CLI 写死，不接受 `--prompt`。要换 schema 请改用 `understand` 任务自己写 prompt。

## 关键行为

- **video-only**：`appliesTo: ["video"]`。传音频会被 CLI 拦下来。
- **保留画面**：`audioOnly: false`，Ark 收到 `video_url`，画面 + 音频一起进模型。
- **输出是 JSON 字符串**，不是带 markdown fence 的代码块。直接 `JSON.parse(text)` 即可。
- 切片时每段独立产出一个 JSON 对象，最终 `merged` 用 `=== Part N ===` 分隔；后处理需要按段 parse，再把 `timeline_events` 合并 + 按 `globalStart = local + segments[N].start_sec` 修正时间。

## 示例输出

```json
{
  "timeline_events": [
    {
      "start_end_time": "00:03-00:05",
      "event": "穿蓝色连帽衫的男子载着穿黑黄上衣的女子，未及时注意路况，重重撞上路边停放的黑色汽车…",
      "people": "穿蓝色连帽衫的男子、穿黑黄上衣的女子",
      "emotion": "事发突然，两人毫无防备，后续查看自身状况时带着明显的慌乱"
    },
    {
      "start_end_time": "00:06-00:23",
      "event": "穿蓝色连帽衫的男子立刻起身，快速转身搀扶起坐在地上的女同伴…",
      "people": "穿蓝色连帽衫的男子、穿黑黄上衣的女子、多位过路行人",
      "emotion": "蓝帽衫男子焦急关切，过路路人带着围观的诧异情绪"
    }
  ]
}
```

## 解析

```ts
import type { TimelineEvent } from "./types";
const data = JSON.parse(result) as { timeline_events: TimelineEvent[] };
// 多段时：results.segments.map(s => JSON.parse(s.text).timeline_events).flat()
// 注意把 start_end_time "MM:SS-MM:SS" 加上对应段的全局偏移 segments[N].start_sec
```

## 字段说明

| 字段（常见名） | 同义别名 | 含义 | 备注 |
|---------------|----------|------|------|
| `start_end_time` | — | `MM:SS-MM:SS` 区间 | 局部时间，多段时需要加 `segments[N].start_sec` |
| `event` | — | 事件描述 | 自然语言，长度不固定 |
| `people` | `people_involved` | 出场人物 | 顿号分隔字符串，不是数组 |
| `emotion` | `emotion_performance` | 情绪/氛围 | 自然语言 |

外层数组键也会漂：常见 `timeline_events`，但实测也见过 `time_axis_events`。模型不保证字段命名稳定，建议按下面的归一化器消费：

```ts
type TimelineEvent = {
  startEndTime: string;
  event: string;
  people: string;
  emotion: string;
};
const root = JSON.parse(text) as Record<string, unknown>;
const arr =
  (root.timeline_events as any[]) ??
  (root.time_axis_events as any[]) ??
  Object.values(root).find(Array.isArray) ??
  [];
const events: TimelineEvent[] = arr.map((e) => ({
  startEndTime: e.start_end_time,
  event: e.event,
  people: e.people ?? e.people_involved ?? "",
  emotion: e.emotion ?? e.emotion_performance ?? "",
}));
```

如果对字段名稳定性有强要求，请改用 `understand` 任务在 prompt 里写死 schema（见 [understand.md](understand.md) 的 JSON 推荐用法），或者 `--system-prompt` 里追加"严格使用以下字段名"。

## 何时用其它 task

- 想要 markdown 报告而不是 JSON → `caption`
- 想要自定义 schema（增删字段） → `understand` + 自己写 prompt
- 只看声音事件（无画面） → `caption` + `--type audio`

## CLI

```bash
# 远程视频
bun run {baseDir}/scripts/main.ts \
  --task video-timeline \
  --url "https://ark-public.tos-cn-beijing.volces.com/carcrash.mp4" --type video \
  --out-dir ./out/timeline

# 本地视频
bun run {baseDir}/scripts/main.ts \
  --task video-timeline \
  --path ./match.mp4 \
  --out-dir ./out/match-timeline
```
