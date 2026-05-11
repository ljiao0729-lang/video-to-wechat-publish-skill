# Task: `keyframe-extract` — 技术博客配图关键帧

为「视频 → 技术博客」工作流定制的 task：让模型扫一遍视频，挑出 5-15 个最适合作为博客插图的关键时刻，每个返回 `timestamp / timestamp_sec / description / suggested_caption / reason`。可选传入视频转录稿，模型据此更准确地定位"关键节点"。

模型只输出**时间戳和文字描述**，不直接产出截图——用户拿到 JSON 后，按 `timestamp_sec` 用 ffmpeg 自己抽帧。

## System Prompt

```
你是一位资深技术视频剪辑师与技术博客插图编辑，擅长从演讲、教程、产品演示、技术分享类视频中挑选最适合作为博客配图的画面。你输出的每一帧都让读者一眼读懂关键信息。
```

需要替换角色（"你是 CS2 解说"），用 `--system-prompt` / `--system-prompt-file` 注入。

## User Prompt

```
你正在为一篇技术博客挑选适合配图的关键视频帧。请仔细观看本视频，挑选 5-15 个最具插图价值的关键时刻。

挑选标准（按重要性排序）：
1. **视觉信息密度高** —— 含架构图、代码、演示界面、白板、图表、UI 截图等可读信息的画面优先
2. **承载关键论点** —— 能直观说明文章核心步骤或结论的画面优先
3. **场景多样** —— 避免连续选择视觉上重复的镜头（如同一个特写人脸的多次出现）
4. **构图完整** —— 选取镜头静止、画面清晰、无运动模糊和转场过渡的瞬间

严格按以下 JSON 格式输出（不要 markdown 代码块、不要任何解释文字）：

{
  "keyframes": [
    {
      "timestamp": "MM:SS",
      "timestamp_sec": 0.0,
      "description": "画面内容的客观描述，<= 60 字，重点说明可见的具体元素",
      "suggested_caption": "适合写在博客图片下方的简洁说明，<= 25 字",
      "reason": "为什么这一帧值得作为配图（关联视频此时的核心信息）"
    }
  ]
}

要求：
- timestamp 与 timestamp_sec 必须对应同一时刻；timestamp_sec 单位为秒，保留 1 位小数
- 如果整段视频确实没有视觉看点，返回 {"keyframes": []}

【可选】当传入 --transcript / --transcript-file 时，prompt 末尾会拼接：
以下是视频对应的转录稿，可作为定位关键时刻的参考（最终请以画面内容为准）：
「<transcript 全文>」
```

prompt 由 CLI 写死，不接受 `--prompt`。要换 schema 请改用 `understand` 任务自己写 prompt。

## 关键行为

- **video-only**：`appliesTo: ["video"]`。传音频会被 CLI 拦下来。
- **保留画面**：`audioOnly: false`，Ark 收到 `video_url`，画面 + 音频一起进模型。
- **transcript 是可选辅助**：不传也能跑；传了会拼到 prompt 末尾，模型据此对齐画面与文字。
- **输出是 JSON 字符串**，不是带 markdown fence 的代码块。直接 `JSON.parse(text)` 即可。
- **数量软约束**：prompt 建议 5-15 个，模型偶尔会超界，由用户自己截断。
- **多段视频**：每段独立一个 JSON 对象，最终 `merged` 用 `=== Part N ===` 分隔；后处理需要按段 parse，再把 `timestamp_sec` 加上对应段的 `segments[N].start_sec`。

## 示例输出

```json
{
  "keyframes": [
    {
      "timestamp": "00:42",
      "timestamp_sec": 42.0,
      "description": "白板上画出三层架构图：客户端、API 网关、后端服务，箭头指向数据流向",
      "suggested_caption": "图1：核心三层架构示意",
      "reason": "首次完整呈现系统架构，是后续讲解的基础视觉锚点"
    },
    {
      "timestamp": "03:15",
      "timestamp_sec": 195.0,
      "description": "VS Code 中 useEffect Hook 完整代码段，行号 12-28 高亮，依赖数组用红框标记",
      "suggested_caption": "图2：依赖数组的常见误用",
      "reason": "对应文章关于 useEffect 闭包陷阱的核心代码示例"
    },
    {
      "timestamp": "07:08",
      "timestamp_sec": 428.5,
      "description": "Chrome DevTools Performance 面板，火焰图突出显示长任务红色三角警告",
      "suggested_caption": "图3：长任务定位",
      "reason": "演示性能瓶颈定位流程的关键截图"
    },
    {
      "timestamp": "11:30",
      "timestamp_sec": 690.0,
      "description": "修复后的 Lighthouse 跑分报告，性能分从 42 跃升至 91，绿色环形图占满",
      "suggested_caption": "图4：优化前后对比",
      "reason": "结论性数据，直观说明优化效果"
    },
    {
      "timestamp": "13:45",
      "timestamp_sec": 825.0,
      "description": "终端中 `npm run build` 输出，bundle 大小从 1.2MB 降到 380KB，对比表格清晰",
      "suggested_caption": "图5：构建产物体积对比",
      "reason": "二级结论的量化证据，适合作为文章末尾的总结配图"
    }
  ]
}
```

## 解析

```ts
type Keyframe = {
  timestamp: string;
  timestampSec: number;
  description: string;
  suggestedCaption: string;
  reason: string;
};

function parseTimestamp(s: string): number {
  // 兼容 MM:SS 和 HH:MM:SS
  const parts = s.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.NaN;
}

function normalizeKeyframes(text: string, segmentStartSec = 0): Keyframe[] {
  const root = JSON.parse(text) as Record<string, unknown>;
  // 字段名漂移容错
  const arr =
    (root.keyframes as any[]) ??
    (root.key_frames as any[]) ??
    (root.frames as any[]) ??
    (Object.values(root).find(Array.isArray) as any[]) ??
    [];
  return arr.map((k) => {
    const localSec =
      typeof k.timestamp_sec === "number" && !Number.isNaN(k.timestamp_sec)
        ? k.timestamp_sec
        : parseTimestamp(k.timestamp ?? "0:00");
    return {
      timestamp: k.timestamp ?? "",
      timestampSec: localSec + segmentStartSec,
      description: k.description ?? "",
      suggestedCaption: k.suggested_caption ?? k.caption ?? "",
      reason: k.reason ?? "",
    };
  });
}
```

## 多段视频处理

视频 > 20 min 或 > 50 MB 会被切成多段，每段是独立的 Ark 调用，时间戳是该段的局部时间。要还原全局时间戳：

```ts
import payload from "./out/keyframe-extract.json";

const all: Keyframe[] = payload.segments.flatMap((seg: any) =>
  normalizeKeyframes(seg.text, seg.start_sec)
);

// 按全局时间戳排序，去掉前后段相邻 < 3s 的近似重复
all.sort((a, b) => a.timestampSec - b.timestampSec);
const dedup = all.filter(
  (k, i) => i === 0 || k.timestampSec - all[i - 1].timestampSec >= 3
);
```

## 字段说明

| 字段 | 类型 | 含义 | 备注 |
|------|------|------|------|
| `timestamp` | string | `MM:SS` 或 `HH:MM:SS` | 局部时间，多段时需加 `segments[N].start_sec` |
| `timestamp_sec` | number | 同上的秒数表示 | 1 位小数；ffmpeg `-ss` 直接消费 |
| `description` | string | 画面客观描述 | <= 60 字，写画面里"看得到的东西" |
| `suggested_caption` | string | 博客图片说明 | <= 25 字，适合作为图注/alt |
| `reason` | string | 选帧理由 | 关联文章论点；用户筛选时主要看这个字段 |

外层数组键也可能漂：`keyframes` / `key_frames` / `frames`。建议用上面的归一化器消费，不要直接 `data.keyframes`。

## 何时用其它 task

- 想要散文式整体描述 → `caption`
- 想要全量事件流（不挑选） → `video-timeline`
- 想要自定义 schema（增删字段） → `understand` + 自己写 prompt
- 只看声音/对白 → ASR 系列任务

## CLI

```bash
# 远程视频，纯关键帧提取
bun run {baseDir}/scripts/main.ts \
  --task keyframe-extract \
  --url "https://example.com/talk.mp4" --type video \
  --out-dir ./out/keyframes

# 本地视频 + 转录稿（推荐：精度更高）
bun run {baseDir}/scripts/main.ts \
  --task keyframe-extract \
  --path ./talk.mp4 \
  --transcript-file ./talk.transcript.txt \
  --out-dir ./out/keyframes-tx

# 直接传 transcript 字符串
bun run {baseDir}/scripts/main.ts \
  --task keyframe-extract \
  --path ./talk.mp4 \
  --transcript "本期讲 React useEffect 的常见坑..." \
  --out-dir ./out/keyframes-tx
```

## 配图工作流：JSON → ffmpeg 批量截图

拿到 `keyframe-extract.json` 后，一行命令把所有关键帧抽成 jpg：

```bash
# 单段视频（全部时间戳已是全局）
SRC=./talk.mp4
OUT=./blog-frames
mkdir -p "$OUT"
jq -r '.segments[0].text | fromjson | .keyframes[] | "\(.timestamp_sec) \(.suggested_caption)"' \
  ./out/keyframes/keyframe-extract.json |
while IFS=' ' read -r ts caption; do
  idx=$(printf "%02d" $((++i)))
  ffmpeg -hide_banner -loglevel error -ss "$ts" -i "$SRC" -frames:v 1 -q:v 2 \
    "$OUT/frame_${idx}_$(echo "$caption" | tr ' /' '__').jpg"
done
```

多段视频请参考上面「多段视频处理」段，对每段时间戳叠加 `start_sec` 后再 ffmpeg。
