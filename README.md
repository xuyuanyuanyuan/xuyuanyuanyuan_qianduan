# csscagent

csscagent 是面向桩基和工程知识问答的智能助手。系统结合 RAG 知识库检索、Agent 问题分析和通用大模型能力，为网页端提供自然、纯文本、流式展示的工程问答。

## 主要目录

- `app/`：Next.js 页面和 API 路由，网页主入口为 `/api/chat`，`/api/chat-agent` 保留为调试入口。
- `lib/`：前端配置、模型客户端和 Agent 核心逻辑。
- `lib/agents/`：智能体组件，负责问题分析、知识库检索、融合回答和最终格式化。
- `rag-service/`：Python FastAPI RAG 后端，提供 `/health` 和 `/search`。
- `public/`：静态图片和品牌资源。
- `app/globals.css`：全局样式。

## lib/agents 组件

- `query-analyzer`：分析用户问题类型，判断是否需要知识库和通用知识。
- `self-ask-planner`：复杂问题泛化和拆分检索 query；当前能力主要由 `query-analyzer` 与 `answer-orchestrator` 承担。
- `multi-query-retriever`：多 query 检索和结果融合；当前主链路通过 `rag-client` 调用 RAG。
- `rag-client`：调用 Python RAG 后端 `/search`。
- `knowledge-answer-agent`：从知识库片段中提取资料锚点。
- `general-answer-agent`：用通用模型知识进行谨慎补充。
- `answer-judge-agent`：融合知识库锚点与通用回答，形成最终答案结构。
- `answer-orchestrator`：编排完整 Agent 流程。
- `format-final-answer`：将最终结果整理成适合网页展示的纯文本。
- `langchain/`：如存在，作为 LangChain 适配层，可关闭或 fallback。

## 启动方法

PowerShell 启动 RAG 后端：

```powershell
cd C:\cssc_both_agents\cssc-rag_agent\rag-service
.\.venv\Scripts\python.exe app.py
```

PowerShell 激活虚拟环境后启动：

```powershell
cd C:\cssc_both_agents\cssc-rag_agent\rag-service
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python app.py
```

cmd 启动 RAG 后端：

```cmd
cd /d C:\cssc_both_agents\cssc-rag_agent\rag-service
.venv\Scripts\activate.bat
python app.py
```

检查 RAG：

```powershell
curl http://localhost:3001/health
```

调试 Agent：

```powershell
curl -X POST http://localhost:3000/api/chat-agent -H "Content-Type: application/json" -d "{\"text\":\"给我水平荷载桩相关知识\"}"
```

前端开发启动：

```powershell
cd C:\cssc_both_agents\cssc-rag_agent
npm install
npm run dev
```

访问：

```text
http://localhost:3000
```

生产启动：

```powershell
npm run build
npm start
```

## 关键环境变量

```env
RAG_API_URL=http://localhost:3001
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
ANSWER_MODE=agent
AGENT_ENABLE_SELF_ASK=true
AGENT_SHOW_SOURCES=never
AGENT_SHOW_CONFIDENCE=false
AGENT_SHOW_KNOWLEDGE_STATUS=false
AGENT_MAX_OUTPUT_TOKENS=8000
AGENT_KNOWLEDGE_MAX_OUTPUT_TOKENS=4000
AGENT_GENERAL_MAX_OUTPUT_TOKENS=7000
AGENT_JUDGE_MAX_OUTPUT_TOKENS=8000
AGENT_LONG_ANSWER_MAX_CHARS=16000
AGENT_ENABLE_LONG_ANSWER=true
```

不要在 README 或代码中写入真实 API Key。

## 注意事项

- 修改 `.env` 或 `.env.local` 后，需要重启 `npm run dev`。
- RAG 后端默认运行在 `3001`，前端启动前建议先确认 `/health` 正常。
- 不要提交 `.env`、`vector_store/`、`knowledge/` 大文件、`.venv/`、`node_modules/`、`.next/`。
- 知识库不足时，系统会结合通用模型知识回答；具体工程结论仍需以现行规范、设计文件、检测报告和现场资料为准。
