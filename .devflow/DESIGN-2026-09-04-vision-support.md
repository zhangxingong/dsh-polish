# DESIGN 2026-09-04 dsh-polish 视觉支持（图片识别）

## 目标

四角星优化按钮支持识别图片信息：

1. 模型切换为 `deepseek-v4-flash-vision-exp`
2. composer 附件栏已上传的图片随文本一起发给模型
3. 文本中的 http(s) 图片链接由模型侧自动下载识别（链接直传，不 host 下载）

参考文档：https://api-docs.deepseek.com/zh-cn/guides/vision

## 已确认的平台事实（app.asar 2.0.3 源码）

- composer 自带图片附件系统（`dsh-client-ui-attachment`，slot `conversation.input.attachments`）
- 输入状态（`useInput` 全量 selector）含 `draft`、`phase`、`imageIds`（附件 id 数组，见 dsh-client-ui-conversation `ConversationController.input`）
- `conversation` cordis 服务（root 单例，服务名 `conversation`）提供：
  - `draftImages(imageIds)` → 运行时草稿附件描述符（含浏览器 `file`）
  - `serializeDraftImages(imageIds)` → `[{mediaType: 'image/png'|'image/jpeg'|'image/webp'|'image/gif', data: base64, name?}]`
  - `createDraftImages(files)` / `releaseDraftImage(id)` 等
- 平台图片限额：默认 20 张 / 200MB / 消息（`dsh-attachment-local` 配置）
- slot `conversation.input.left` 组件 props = `{session, input}`（zone）+ 标准套件 `useInput` hook / `inputActions` props

## DeepSeek vision API 要点

- 唯一视觉模型 id：`deepseek-v4-flash-vision-exp`
- user 消息 content 为块数组：`[{type:'text',text}, {type:'image_url',image_url:{url}}...]`
- `url` 支持 base64 data URI（`data:<mediaType>;base64,<b64>`）或公网 http(s) 链接（模型自动下载，≤8192 字符、≤32MiB、60s 内）
- 图片只能出现在 user 消息（system/assistant 携带图片 → 400）
- 请求体上限 48 MiB；单图（base64 或 URL）≤ 32 MiB；每图计费 ≤384 tokens

## 架构

### 客户端（src/client）

- `StarButton`：`useInput` 新增 selector 读 `imageIds`（与 draft/phase 同款）
- `apply`：`ctx.inject(['conversation'], ...)` 拿服务，注入 StarButton（inject 语义：服务晚挂载也不竞态）
- 点击编排（orchestrate）：
  1. `imageIds` 非空 → `conversation.serializeDraftImages(imageIds)` → images 载荷；serialize 抛错（如 UnsupportedImageMediaTypeError）→ Toast 报错、不动草稿
  2. POST `/dsh-polish/optimize` body `{text, images:[{mediaType, data}]}`（无图时 `images: []`）
  3. 成功覆盖逻辑不变：只覆盖文本草稿，图片附件保留原样；`getCurrentDraft()` 复核仅比对文本

### 宿主端（src/handler.ts、src/optimize.ts）

- `MODEL = 'deepseek-v4-flash-vision-exp'`
- `buildOptimizePrompt(text, images, opts)`：
  - user content = `[{type:'text',text}]` + images 各转 `{type:'image_url',image_url:{url:'data:<mediaType>;base64,<data>'}}` + 文本内图片链接各转 `{type:'image_url',image_url:{url:<原链接>}}`
  - 链接提取正则（宽松、只认明显图片扩展）：`https?://[^\s"']+?\.(png|jpe?g|gif|webp)(\?[^\s"']*)?`（i 标志）；提取出的链接保留在文本中，不删除
  - system 提示词、temperature 0.3、非流式、max_tokens clamp 不变
- handler 校验（判定顺序沿用现有契约）：
  - `images` 缺省 `[]`；非数组 → 400 invalid-images
  - 每项必须 `{mediaType: 四种之一, data: string}` → 400 invalid-image
  - 单图 base64 解码字节数 ≤ 32MB → 400 image-too-large；张数 ≤ 20 → 400 too-many-images
  - `MAX_BODY_BYTES` 2MB → 48MB（对齐 DeepSeek 请求体上限）
  - 文本校验不变（text 非字符串/空白/200KB）
- 错误路径不变：OptimizeError → 502 透传 code/message（模型侧链接下载失败同样透出）

## 数据流

```
点击四角星
→ useInput 读 {draft, phase, imageIds}
→ conversation.serializeDraftImages(imageIds) → [{mediaType, data}]
→ POST /dsh-polish/optimize {text, images}
→ handler 校验（信任域 fence → body/文本/图片限额）
→ buildOptimizePrompt → DeepSeek vision 直连（非流式）
→ 优化文本 → 客户端复核草稿未变 → setDraft 覆盖 + 光标末尾；图片附件不动
```

## 错误处理

| 场景 | 行为 |
|---|---|
| serializeDraftImages 抛错 | Toast 原错误消息，草稿与图片不动 |
| images 结构非法 / 超限 | 400 对应 code，客户端 Toast「请求失败：...」 |
| DeepSeek 链接下载失败 / API 错误 | 502 透传，Toast |
| 请求超时 | 现有 30s AbortSignal（两侧 fetch），Toast |

## 测试

- `tests/unit/optimize.unit.test.mjs`：content 块断言（纯文本 / data URI / 链接提取 / 混合）、链接正则边界（无扩展名不提取、query 参数保留）
- `tests/unit/handler.unit.test.mjs`：images 缺省/非法/超限/413、正文兼容旧 `{text}` 形状
- `tests/unit/orchestrate.unit.test.mjs`：imageIds 空/非空传参、serialize 抛错不 post
- 全量 `pnpm test`（70 既有 + 新增）全绿

## 验收（Task 6 式清单）

1. composer 附件栏传 1-2 图 + 文本 → 点四角星 → 文本被覆盖、图片保留、光标末尾
2. 文本带公网图片链接（png/jpg）→ 模型识别图内信息并优化文本
3. 纯文本 → 行为与之前一致（同一模型）
4. Read Only 置灰、空输入 Toast、草稿变化不覆盖 —— 回归
5. 设置卡片自定义 systemPrompt 仍生效

## 已知限制（交付时声明）

- 图片链接必须公网可达（用户已确认直传方案）
- 仅识别明显图片扩展名的链接；无扩展名图片 URL 不提取
- vision-exp 每图独立计费（≤384 tokens/图）
