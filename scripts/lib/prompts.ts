export type TaskKey =
  | "asr"
  | "asr-timestamp"
  | "multispeaker-asr"
  | "ast"
  | "diarize"
  | "subtitle-align"
  | "caption"
  | "video-timeline"
  | "keyframe-extract"
  | "understand";

export type TaskTemplate = {
  key: TaskKey;
  label: string;
  systemPrompt?: string;
  userPrompt: (vars: TemplateVars) => string;
  appliesTo: ("audio" | "video")[];
  audioOnly: boolean;
};

export type TemplateVars = {
  prompt?: string;
  language?: string;
  targetLanguage?: string;
  subtitleText?: string;
  transcriptText?: string;
  partLabel?: string;
};

const ASR_SYSTEM = `You are a highly advanced AI specialized in Automatic Speech Recognition (ASR). Your sole function is to transcribe the audio provided by the user.
You must adhere to the following rules STRICTLY:
1. Your output must contain ONLY the transcribed text from the audio.
2. Do not include any introductory phrases, explanations, apologies, or any other conversational text.
3. Do not use any formatting, such as markdown, bolding, or italics.
4. If the audio is unclear, inaudible, or contains no speech, you must output an empty string.`;

const TIMESTAMP_SYSTEM = `你是一个多语种语音识别专家，能够理解捕捉在语音识别过程中的时序关系。你必须按着用户给定的模板进行输出，避免其他无关的输出内容。`;

const TIMESTAMP_USER = `请转录这段音频文件。对于识别出的每一个字请提供其精确的开始时间和结束时间。
你需要按着一字一行的格式来排列结果，每一行用';'隔开。每一行的由三部分组成，分别为开始时间、结束时间、转写字符，并且用'-'将它们分割开。要注意开始时间和结束时间的单位为秒，可以精确到小数点后两位。
可以参考下面的模板：
{开始时间}-{结束时间}-{转写字符};{开始时间}-{结束时间}-{转写字符};...{开始时间}-{结束时间}-{转写字符};
注意你只能按着模板输出结果，请勿输出其它无关的信息和内容。`;

const MULTISPEAKER_USER = `下面是一段多人说话的语音，你需要识别说话内容并标记每句话对应的说话人。对话中出现的第一个人用[spk0]表示，第二个人用[spk1]表示，以此类推。请顺序输出说话人编号以及语音内容。`;

const DIARIZE_SYSTEM = `你是一位顶尖的音频分析专家，能够精准地识别出每一位说话者，并为他们说的话标注精确的时间点。`;

const DIARIZE_USER = `这是一段多人说话的语音，你需要识别说话内容，标记每句话对应的说话人并且标记每句话的开始时间和结束时间。对话中出现的第一个人用[spk0]表示，第二个人用[spk1]表示，以此类推。每句话先标记说话人，再标记开始时间和结束时间，最后输出内容，格式: [spk0][开始时间-结束时间]说话内容。
要注意开始时间和结束时间的单位为秒，可以精确到小数点后两位。
注意你只能按着模板输出结果，请勿输出其它无关的信息和内容。`;

const CAPTION_SYSTEM = `你是一位资深音频/视频描述专家，听觉灵敏、逻辑严谨、有良好的文学创作素养和通感能力，擅长听音/看图写描述。`;

const KEYFRAME_SYSTEM = `你是一位资深技术视频剪辑师与技术博客插图编辑，擅长从演讲、教程、产品演示、技术分享类视频中挑选最适合作为博客配图的画面。你输出的每一帧都让读者一眼读懂关键信息。`;

function buildKeyframeUser(transcript?: string): string {
  const transcriptBlock = transcript && transcript.trim().length > 0
    ? `\n\n以下是视频对应的转录稿，可作为定位关键时刻的参考（最终请以画面内容为准）：\n「${transcript}」`
    : "";
  return `你正在为一篇技术博客挑选适合配图的关键视频帧。请仔细观看本视频，挑选 5-15 个最具插图价值的关键时刻。

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
- 如果整段视频确实没有视觉看点，返回 {"keyframes": []}${transcriptBlock}`;
}

const CAPTION_USER = `请按照以下 markdown 格式整体描述这段媒体：
### 概述
整体概述其物理属性（时长、音色音量、清晰度等）、核心内容构成与整体感受。
### 内容分析
概括对话或独白的主要发展，给出标题与摘要。
### 说话人信息（如有）
对说话部分进行说话人语音特征分析。
### 声音事件信息
对非言语部分进行声学特征分析。
### 视觉信息（如视频）
对画面关键场景、字幕、人物动作进行描述。`;

export const TASK_TEMPLATES: Record<TaskKey, TaskTemplate> = {
  asr: {
    key: "asr",
    label: "纯文字 ASR",
    systemPrompt: ASR_SYSTEM,
    userPrompt: () => "这段语音的内容是：",
    appliesTo: ["audio", "video"],
    audioOnly: true,
  },
  "asr-timestamp": {
    key: "asr-timestamp",
    label: "带时间戳的 ASR",
    systemPrompt: TIMESTAMP_SYSTEM,
    userPrompt: () => TIMESTAMP_USER,
    appliesTo: ["audio", "video"],
    audioOnly: true,
  },
  "multispeaker-asr": {
    key: "multispeaker-asr",
    label: "多说话人 ASR",
    userPrompt: () => MULTISPEAKER_USER,
    appliesTo: ["audio", "video"],
    audioOnly: true,
  },
  ast: {
    key: "ast",
    label: "语音翻译 (AST)",
    systemPrompt: `Your task is to accurately translate the spoken content in the audio and return it in text form.`,
    userPrompt: (v) =>
      `把这句话翻译成${v.targetLanguage ?? "中文"}，最终输出仅能是翻译结果，不要返回任何其他多余的内容。`,
    appliesTo: ["audio", "video"],
    audioOnly: true,
  },
  diarize: {
    key: "diarize",
    label: "说话人日志 (Diarization + ASR)",
    systemPrompt: DIARIZE_SYSTEM,
    userPrompt: () => DIARIZE_USER,
    appliesTo: ["audio", "video"],
    audioOnly: true,
  },
  "subtitle-align": {
    key: "subtitle-align",
    label: "字幕打轴",
    systemPrompt: `你拥有对齐语音内容与转写文本的能力，你能深刻理解语音中存在的时序关系，现在需要你按照用户的要求输出用户所需要的识别结果。你必须按照用户给定的模板进行输出，避免其他无关的输出内容。`,
    userPrompt: (v) =>
      `听写这段音频，音频对应转写结果为：「${v.subtitleText ?? ""}」。现在我需要你根据音频的转写结果把音频中的每个字符都对应上它的开始时间和结束时间。要求你不要篡改转写结果，只需要根据音频的转写结果输出对应的时间信息。
你需要按着一字一行的格式来排列结果，每一行用';'隔开。每一行的由三部分组成，分别为开始时间、结束时间、转写字符，并且用'-'将它们分割开。要注意开始时间和结束时间的单位为秒，可以精确到小数点后两位。
可以参考下面的模板：
{开始时间}-{结束时间}-{转写字符};...{开始时间}-{结束时间}-{转写字符};
注意你只能按着模板输出结果，请勿输出其它无关的信息和内容。`,
    appliesTo: ["audio", "video"],
    audioOnly: true,
  },
  caption: {
    key: "caption",
    label: "音/视频整体分析",
    systemPrompt: CAPTION_SYSTEM,
    userPrompt: () => CAPTION_USER,
    appliesTo: ["audio", "video"],
    audioOnly: false,
  },
  "video-timeline": {
    key: "video-timeline",
    label: "视频时间轴 JSON 分析",
    userPrompt: () =>
      "对视频内容进行时间轴式分析，返回一个JSON格式，包括开始时间-结束时间、事件、人物、情绪等",
    appliesTo: ["video"],
    audioOnly: false,
  },
  "keyframe-extract": {
    key: "keyframe-extract",
    label: "技术博客配图关键帧",
    systemPrompt: KEYFRAME_SYSTEM,
    userPrompt: (v) => buildKeyframeUser(v.transcriptText),
    appliesTo: ["video"],
    audioOnly: false,
  },
  understand: {
    key: "understand",
    label: "通用音/视频理解 + 自定义 Prompt",
    systemPrompt: `你是音/视频理解专家，擅长结合画面、声音和语音内容回答用户问题。`,
    userPrompt: (v) => v.prompt ?? "请描述这段媒体的关键信息。",
    appliesTo: ["audio", "video"],
    audioOnly: false,
  },
};

export function listTaskKeys(): TaskKey[] {
  return Object.keys(TASK_TEMPLATES) as TaskKey[];
}

export function buildPartHeader(partLabel: string): string {
  return `（注：本次输入为整段媒体的 ${partLabel} 片段，请仅基于本片段内容回答。）\n`;
}
