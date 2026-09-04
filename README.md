# dsh-polish

DSH Desktop 输入框四角星按钮插件：一键调用 DeepSeek 优化并细化当前输入，润色语句、梳理逻辑、补充细节后**整体覆盖**草稿，光标定位文本末尾。

- 按钮位于底部工具栏书本图标（精读）右侧（`conversation.input.left`，order 31）
- 权限下拉切到 Read Only 时按钮置灰不可点
- 输入框为空时点击提示「请先输入内容再进行优化细化」
- host 半直连 `api.deepseek.com`（model `deepseek-v4-flash-vision-exp`，非流式）；密钥走 DSH credentials 服务，兜底 `DEEPSEEK_API_KEY` 环境变量
- **支持图片识别**：composer 附件栏已上传的图片随优化请求一起发送；文本中的公网图片链接（png/jpg/jpeg/gif/webp）由模型侧自动下载识别
- RPC 路由 `POST /dsh-polish/optimize` 带 loopback trust fence
- **个性化优化设置**：设置 → 插件设置 → dsh-polish 卡片，可编辑优化系统提示词（初值 = 内置默认提示词，多行等宽编辑器），保存后持久化并立即生效；清空保存回退默认

## 安装

```bash
pnpm install
pnpm build
dsh plugin --profile <name> add "link:<本目录绝对路径>"
```

安装后重启 DSH Desktop。若 profile 的 `node_modules/@deepseek-ai` 出现真实目录副本（双实例崩溃坑），请将其替换为指向 app 副本的悬空 Junction（profile-only 包如 dsh-plugin-check 除外）。

## 开发

```bash
pnpm test    # node --test，87 用例（pretest 自动构建）
pnpm check   # tsc host + client
```

MIT
