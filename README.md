# CocoaChat

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Akokko/cocoachat)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)
![React 19](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-38bdf8)

> BYOK（Bring Your Own Key）AI 聊天客户端：自带 OpenAI 兼容 API Key，会话和设置全部保存在浏览器本地，服务端只做无状态透传。

<!-- TODO: 此处放截图 docs/screenshot-light.png / docs/screenshot-dark.png -->

## 特性

- **多 provider** —— 任何 OpenAI 兼容端点：OpenAI / DeepSeek / Moonshot / 本地 Ollama 等，改 Base URL 即用
- **流式输出** —— 逐 token 渲染，可中途停止
- **多会话并发** —— 一个会话流式中切去另一个会话，原会话仍在后台继续写，切回来直接看到完整内容
- **编辑重发 / 重新生成** —— 修改任意一条 user 消息后自动截断并重新生成；最末回复一键重生
- **Markdown + 代码高亮** —— react-markdown + Shiki dual-theme，代码块带语言标签和复制按钮
- **三态主题** —— 跟随系统 / 亮色 / 暗色循环切换，避免一旦点击就被锁死的体验
- **响应式** —— 桌面双栏，移动端 Sidebar 变 Drawer
- **本地优先** —— API Key、设置、所有会话和消息都只存在浏览器 IndexedDB

## 快速开始

### 一键部署到 Vercel

点击顶部 **Deploy with Vercel** 按钮，部署后无需配任何环境变量——直接打开站点，在右下角「设置」里填自己的 API Key 即可。

### 本地开发

```bash
git clone https://github.com/Akokko/cocoachat.git
cd cocoachat
pnpm install
pnpm dev
```

打开 `http://localhost:3000`，在「设置」里填：

| 字段 | 示例 |
|---|---|
| API Key | `sk-...`（OpenAI / DeepSeek / Moonshot / 自托管的密钥） |
| Base URL | `https://api.openai.com/v1`（默认）/ `https://api.deepseek.com/v1` 等 |
| Model | `gpt-4o-mini` / `deepseek-chat` / 任意端点支持的模型名 |

## 隐私声明

- API Key、对话内容、所有设置 **仅保存在浏览器 IndexedDB**，不会上传到任何服务器
- `/api/chat` 路由是无状态透传层：把 API Key 和 messages 直接转发给上游 provider，不写日志、不缓存、不持久化
- 部署到自己的 Vercel 后，"服务端"也只是你自己的实例，凭据不经过任何第三方
- 清空数据：浏览器 DevTools → Application → IndexedDB → 删 `cocoa-chat` 数据库

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router、Node Runtime） |
| UI | React 19 · Tailwind CSS v4 · shadcn/ui（base-ui primitives） |
| 状态 | Zustand v5 |
| 存储 | IndexedDB（idb） |
| AI | OpenAI SDK + 自研 NDJSON 流式协议 |
| 高亮 | Shiki 4（dual-theme，CSS 切换无需重新渲染） |
| 动画 | framer-motion v12 |

## 架构概览

```
┌──────────────────────────────────────────────┐
│  Browser                                     │
│  ┌────────────┐    ┌──────────────────────┐  │
│  │ Zustand    │◄──►│ IndexedDB            │  │
│  │  - 会话    │    │  - conversations     │  │
│  │  - 消息    │    │  - messages          │  │
│  │  - 设置    │    │  - settings          │  │
│  └─────┬──────┘    └──────────────────────┘  │
│        ▼                                     │
│  React UI ─── fetch /api/chat ──┐            │
└─────────────────────────────────┼────────────┘
                                  ▼
                  ┌─────────────────────────┐
                  │ Next.js Route Handler   │
                  │   无状态透传，不持久化     │
                  └─────────┬───────────────┘
                            ▼
                  OpenAI 兼容 provider
```

## 设计要点

- **BYOK 安全模型** —— API Key 走 request body 不走 URL/header，避免被中间件 / 反向代理日志记录
- **NDJSON 流式协议** —— 比裸 SSE 更易解析，配合 `TextDecoder({ stream: true })` 处理跨 chunk UTF-8 截断
- **端到端 AbortController** —— UI → fetch → route handler → OpenAI SDK → 上游，全链路统一中止
- **`messagesByConv` 多会话架构** —— 按 `conversationId` 索引消息缓存，配合按 conv 维护的 `controllers Map`，实现"切走会话仍在后台流式"
- **IndexedDB 单事务** —— 写消息和顶起会话 `updatedAt` 在同一 transaction 内，避免"消息落盘但排序时间戳没更"的不一致
- **React 19 严格 lint 兼容** —— `useSyncExternalStore` 替代 `useEffect + setMounted`、render-phase 条件 setState 派生 prev props，无任何 lint disable

## 项目结构

```
app/
  api/chat/route.ts          流式透传路由
  layout.tsx · page.tsx
components/
  chat/                      消息列表、输入框、Markdown 渲染、代码块
  layout/                    AppShell、Sidebar、ChatView、MobileDrawer
  settings/                  SettingsDialog
  ui/                        shadcn 生成的 base-ui 包装
lib/
  ai/streamClient.ts         浏览器侧 NDJSON 解析（async generator）
  hooks/useChatStream.ts     流式编排（多会话并发 controllers）
  storage/                   IndexedDB schema + repository
  store/                     Zustand stores（chat / settings）
  errors.ts                  StreamError + 错误文案翻译
```

## License

MIT
