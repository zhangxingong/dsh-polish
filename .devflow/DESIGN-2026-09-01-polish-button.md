# dsh-polish：输入框四角星「优化并细化当前用户输入」按钮

日期：2026-09-01 · 状态：已获用户批准 · 目标：DSH Desktop（desktop profile，2.0.3）

## 需求（用户 PRD 摘要）

底部工具栏书本图标（deepread 📖，`conversation.input.left` order 30）右侧加四角星按钮：

- 图标：细线空心四角星，四角顶点带小圆点，`currentColor` 浅灰，无填充；尺寸/高度/间距/线条粗细与现有工具按钮一致；Tooltip「优化并细化当前用户输入」；深色主题适配
- 只读模式（权限下拉 = read-only）开启时按钮置灰禁点
- 输入框为空：点击 Toast「请先输入内容再进行优化细化」
- 有文本：读取全文 → LLM 润色/理逻辑/补细节/规范化 → 优化文本**整体覆盖**草稿 → 光标定位文本末尾
- 其余 UI/功能不动

## 架构

新插件 `dsh-polish`（dsh-plugins monorepo `packages/dsh-polish`），link 进 desktop profile。host + client 双半：

```
client（browser bundle，window.__ModuleLoader__）
  slots.inject('conversation.input.left')  → id 'polish-composer', order 31
  标准 props：useProjection('permissions') / useInput / inputActions / sessionId
        │ 同源 fetch POST /dsh-polish/optimize
        ▼
host（cordis 插件，webServer 路由 + loopback trust fence）
  校验 fence → 直调 api.deepseek.com /chat/completions（非流式）
  key：credentials seam → DEEPSEEK_API_KEY env 兜底（dsh-vision 同链路）
```

- trust fence / RPC 工具：抄 composer-tools 现成 `trust-fence.ts` + `http-util.ts`（同 monorepo，已验证）
- 槽位/API 依据（2.0.3 实测）：`conversation.input.left` 为 list/session 槽；`useProjection("permissions")` 返回 `{ currentValue, options }`；`inputActions.setDraft(text)` 是官方唯一公开草稿写入路径（InputZone 契约 + provide channel 均已确认）；client 平台 externals：`dsh-client-ui-primitives`（Toast/Tooltip 均已导出）

## 交互状态机（client 按钮组件）

| 状态 | 条件 | 行为 |
|---|---|---|
| 置灰 | `permissions.currentValue === 'read-only'` 或 `input.phase ∈ {submitting, adjudicating}` | disabled，点击无动作 |
| 空输入 | `draft.trim() === ''` | Toast「请先输入内容再进行优化细化」 |
| 正常 | 有文本 | 按钮 loading → POST 原文 → 成功 `setDraft(优化文本)` |
| 失败 | RPC/API 错误 | Toast 错误信息，draft 不动 |

成功后：focus 输入 textarea（DOM 锚点 `[data-phase]`）+ rAF 后 `setSelectionRange(len, len)`（官方 restoreCaret 同款时机）。loading 期间按钮禁用防连点。

注：submitting/adjudicating 置灰非 PRD 明文，属防数据损坏的保守默认（发送中替换草稿会破坏发送链路）。

## 优化调用

- model：`deepseek-v4-flash`（profile 已验证的模型 id；实现时核对 dsh-llm-deepseek 的官方路由映射，若 API id 不同以映射为准）
- system prompt（由 PRD 规则直译）：保留核心意图不篡改原意；理顺逻辑、修正语病、删冗余；补缺失细节、扩描述层次；维持原有语气风格。**只输出优化后正文，不加任何说明**
- user message：原文
- temperature 0.3；max_tokens = min(输入字符数×2 + 512, 8192)；非流式

## 文件规划

```
packages/dsh-polish/
  package.json            # dsh.bundle.patch + dsh.client 声明（照 composer-tools）
  cordis.patch.yml
  tsdown.config.mjs / tsdown.config.client.mjs（或合并，照 composer-tools）
  src/
    index.ts              # host 入口：webServer 路由 + fence + optimize 纯函数调用
    optimize.ts           # prompt 构造 + DeepSeek 直连 + 响应解析（纯函数可测）
    trust-fence.ts        # 抄 composer-tools
    http-util.ts          # 抄 composer-tools
    client/
      index.tsx           # slots.inject + StarButton 组件（状态机 + Toast + 光标定位）
      state.ts            # 状态判定纯函数（read-only/empty/normal）
      icon.tsx            # 四角星 SVG
      styles.ts           # 按钮样式（对齐官方工具按钮）
  tests/（node --test）
    optimize.test.ts      # prompt 构造 / 响应解析 / token 预算
    state.test.ts         # 状态机三态判定
    fence.test.ts         # trust fence 拒绝非 loopback
```

## 验收

1. 单测全绿（node --test）
2. link 进 desktop profile（bundles 末尾）→ 重启 DSH Desktop 实测：
   - 按钮出现在书本图标右侧、样式与工具栏一致、深色正常
   - Tooltip 文案正确
   - 只读模式 → 置灰；空输入 → Toast；有文本 → 覆盖替换 + 光标末尾
   - 优化质量抽查（保留原意/逻辑/语气）
3. 安装后复查 profile `@deepseek-ai` junction（已知坑）

## 风险

- `inputActions`/`useProjection` 属 standard props，官方未承诺稳定，DSH 升级后需回归
- 模型 id 随 API 变更可能失效（实现时核对官方映射）
- 长文本 token 预算上限 8192，超长输入会被截断（max_tokens 预算内）

## 明确不做（YAGNI）

- 不做设置面板（模型/提示词硬编码常量）
- 不做流式输出/差异对比预览（PRD 要求直接覆盖）
- 不做 e2e playwright（手动验收覆盖）
