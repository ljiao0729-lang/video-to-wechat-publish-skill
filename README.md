# 视频转公众号同步发布

把一条本地视频自动处理成公众号图文稿，并创建到公众号草稿箱的 Codex Skill。

它适合这类场景：

- 访谈、播客、直播回放、课程视频转公众号文章
- 从视频里提炼观点，改写成更适合阅读的图文稿
- 自动选择 3-5 张配图，并插入到文章合适位置
- 按 mdnice / 墨滴风格生成可复制的公众号 HTML
- 使用你自己的公众号 API，把文章创建到草稿箱

## 能做什么

完整流程包括：

1. 用火山方舟 Doubao-Seed 理解视频内容
2. 生成公众号文章初稿
3. 按用户提供的文风样本继续改写
4. 从视频里挑选 3-5 张适合配文的截图
5. 生成公众号排版 HTML
6. 上传正文图片和封面图到公众号后台
7. 创建公众号草稿

底层也保留了独立的视频理解能力，例如 ASR 转写、视频时间轴、关键帧提取、自定义视频问答等。

## 目录结构

```text
.
├── SKILL.md
├── .env.example
├── agents/
├── references/
└── scripts/
    ├── main.ts
    ├── wechat_draft.py
    └── lib/
```

关键文件：

- `SKILL.md`：Codex Skill 说明文件
- `.env.example`：API 配置模板
- `scripts/main.ts`：Doubao 视频理解 CLI
- `scripts/wechat_draft.py`：公众号草稿创建脚本

## 安装

把这个仓库 clone 到本地：

```bash
git clone https://github.com/ljiao0729-lang/video-to-wechat-publish-skill.git
cd video-to-wechat-publish-skill
```

安装 Bun 依赖：

```bash
cd scripts
bun install
cd ..
```

确保本地有 `ffmpeg` 和 `ffprobe`：

```bash
ffmpeg -version
ffprobe -version
```

macOS 可以用 Homebrew 安装：

```bash
brew install ffmpeg
```

## 配置自己的 API

复制配置模板：

```bash
cp .env.example .env
```

然后填写你自己的 API：

```bash
# Volcengine Ark / Doubao
ARK_API_KEY=
ARK_MODEL=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_REASONING_EFFORT=minimal

# Volcengine TOS
TOS_ACCESS_KEY_ID=
TOS_ACCESS_KEY_SECRET=
TOS_BUCKET=
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_KEY_PREFIX=doubao-multimodal

# WeChat Official Account
WECHAT_APPID=
WECHAT_APPSECRET=
WECHAT_AUTHOR=
```

`.env` 只保存在你自己的电脑里，不要提交到 GitHub。

## API 权限说明

### 火山方舟 / Doubao

需要：

- `ARK_API_KEY`
- `ARK_MODEL`

模型需要支持音视频理解。不同账号可用模型名称可能不同，填写你自己火山方舟控制台里的 endpoint 或 model id。

### 火山 TOS

本地视频需要先上传到 TOS，生成临时 URL 给 Doubao 读取，所以需要：

- `TOS_ACCESS_KEY_ID`
- `TOS_ACCESS_KEY_SECRET`
- `TOS_BUCKET`
- `TOS_REGION`
- `TOS_ENDPOINT`

### 公众号

需要：

- `WECHAT_APPID`
- `WECHAT_APPSECRET`
- 公众号后台 IP 白名单

查看位置：

公众号后台 → 设置与开发 → 基本配置

如果创建草稿时报错 `40164 invalid ip`，把错误里显示的 IP 加到公众号后台的 IP 白名单后重试。

## 使用方式

### 1. 视频理解

示例：对本地视频做整体理解。

```bash
bun run scripts/main.ts \
  --task understand \
  --path "/abs/path/to/video.mp4" \
  --prompt "请理解这条视频，提炼适合公众号文章的主题、核心观点、人物关系、金句和可配图位置。" \
  --out-dir "./out/video-understand" \
  --env-file ".env"
```

### 2. 提取关键帧建议

```bash
bun run scripts/main.ts \
  --task keyframe-extract \
  --path "/abs/path/to/video.mp4" \
  --out-dir "./out/keyframes" \
  --env-file ".env"
```

之后可用 `ffmpeg` 按模型给出的时间点截图，并人工筛选 3-5 张更适合发布的图片。

### 3. 创建公众号草稿

当你已经准备好公众号排版目录后，目录里需要有：

```text
墨滴风格排版/
├── 公众号排版稿_可复制片段.html
├── 公众号后台填写信息.md
└── images/
    ├── 00_wechat_cover_dialog_900x383.jpg
    └── ...
```

运行：

```bash
python3 scripts/wechat_draft.py \
  --base-dir "/abs/path/to/墨滴风格排版" \
  --env-file ".env"
```

脚本会输出：

```text
公众号排版稿_公众号图片URL版.html
公众号草稿创建结果.json
```

成功后，到公众号后台的草稿箱查看。

## 推荐输出目录

建议每条视频单独放一个输出目录：

```text
out/<video-name>-视频转公众号同步发布/
  understand.txt/json
  keyframes/
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
```

## 安全提醒

- 不要把 `.env` 上传到 GitHub
- 不要把 `WECHAT_APPSECRET`、`ARK_API_KEY`、`TOS_ACCESS_KEY_SECRET` 发到公开聊天或文档
- 如果密钥泄露，及时去对应后台重置
- 公众号 API 创建的是草稿，不会自动群发

## 常见问题

### 报错：缺少 ARK_API_KEY

说明 `.env` 没有配置，或者运行命令没有带 `--env-file ".env"`。

### 报错：invalid ip not in whitelist

去公众号后台把报错里的 IP 加到 IP 白名单。

路径：

公众号后台 → 设置与开发 → 基本配置 → IP 白名单

### 图片上传成功，但草稿里图片不显示

确认正文 HTML 里的本地图片路径能在 `images/` 目录找到。脚本会把本地 `src` 替换成公众号图片 URL。

### 封面图上传失败

公众号缩略图对尺寸和大小比较敏感。脚本会自动压缩封面图，但建议封面使用 JPG，尺寸接近 `900x383`。

## License

MIT
