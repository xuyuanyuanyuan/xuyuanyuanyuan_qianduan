# 工程AI助手前端

本项目是一个基于 Next.js 的聊天前端，支持：

- 浏览器本地聊天记录存储
- `Mock` 模式
- `DeepSeek`
- `OpenAI` 兼容接口

当前模型接入配置已经统一收敛到 `lib/llm-config.ts`，服务端真实请求封装在 `lib/llm-client.ts`，Mock 数据在 `lib/mock-chat.ts`。

## 快速启动

1. 安装依赖：

```bash
npm install
```

2. 复制环境变量模板：

```bash
cp .env .env.local
```

3. 启动项目：

```bash
npm run dev
```

4. 浏览器访问 `http://localhost:3000/`

## 配置入口

模型相关配置统一使用以下环境变量：

- `MOCK_MODE`
- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_TEMPERATURE`
- `LLM_MAX_TOKENS`
- `LLM_TOP_P`

默认路由入口固定为 `app/api/chat/route.ts`，前端页面统一请求 `/api/chat`。

## 切换模式

### 1. 使用 Mock

```env
MOCK_MODE=true
LLM_PROVIDER=mock
```

启用后不会请求真实模型接口，只返回本地模拟数据。

### 2. 使用 DeepSeek

```env
MOCK_MODE=false
LLM_PROVIDER=deepseek
LLM_API_KEY=your-deepseek-key
LLM_MODEL=deepseek-chat
```

说明：

- `LLM_BASE_URL` 留空时，默认使用 `https://api.deepseek.com/v1`
- 如果你有代理地址，也可以手动覆盖 `LLM_BASE_URL`

### 3. 使用 OpenAI 兼容接口

```env
MOCK_MODE=false
LLM_PROVIDER=openai_compatible
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://your-openai-compatible-host/v1
LLM_MODEL=gpt-4o-mini
```

说明：

- `LLM_BASE_URL` 为空时，会走官方 OpenAI 默认地址
- 也可以填写 OneAPI、New API、OpenRouter、vLLM 或自建兼容网关地址

## 推荐目录结构

```text
app/
  api/chat/route.ts        # 路由层，只处理请求体校验和响应返回
  page.tsx                 # UI 页面，只关心聊天展示与本地状态
lib/
  llm-config.ts            # 统一配置解析
  llm-client.ts            # 统一真实模型请求封装
  mock-chat.ts             # Mock 数据与 Mock 流式响应
  conversation-store.ts    # 本地存储
components/
  ...                      # 现有 UI 组件
```

## 数据存储

聊天记录保存在浏览器 `localStorage`：

- `engineering-ai-conversations`
- `engineering-ai-current-chat`

如需清空，可在浏览器控制台执行：

```js
localStorage.clear()
```

## 常见问题

1. 没有返回结果
   检查 `MOCK_MODE`、`LLM_PROVIDER`、`LLM_API_KEY`、`LLM_BASE_URL` 和 `LLM_MODEL` 是否匹配

2. DeepSeek 无法连接
   先确认 `LLM_API_KEY` 是否正确，再检查网络环境或是否需要自定义 `LLM_BASE_URL`

3. 端口被占用
   可以更换端口，或结束占用进程后重新运行

4. Node 版本
   建议使用 Node 20 LTS 或更高版本
