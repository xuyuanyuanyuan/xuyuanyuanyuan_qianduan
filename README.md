# 九工天匠桩基建造智能助手

这是一个面向桩基工程问答的生产交付项目。网页由 Next.js 提供，工程问题经过 Agent 编排后调用本机 Python RAG 服务检索企业知识库，再由 OpenAI-compatible 对话模型生成自然语言回答。

本文档面向第一次接触项目的同事、Windows Server 部署人员和后续维护人员。按本文档操作即可从 U 盘部署，不需要复制其他电脑生成的 Node、Next.js 或 Python 运行缓存。

## 1. 生产调用链

```text
浏览器
  → Next.js http://服务器IP:3000
  → POST /api/chat
  → Agent Orchestrator
      → Query Analyzer
      → Python RAG http://127.0.0.1:3001/search
      → Knowledge Answer Agent
      → General Answer Agent
      → Answer Judge Agent
      → Final Answer Formatter
  → 流式返回网页
```

生产网页固定调用 `/api/chat`。`/api/chat-agent` 仅保留为开发调试接口，不是网页的生产入口。

正常页面只显示最终自然回答，不显示内部 Agent JSON、raw chunks、知识库文件路径、知识库命中状态或置信度。知识库没有合适内容或 RAG 暂时不可用时，允许通用模型继续给出谨慎的工程回答。

## 2. 生产目录结构

```text
cssc-rag_agent/
├─ app/                         Next.js 页面、/api/chat、/api/chat-agent
├─ components/                  页面和 UI 组件
├─ hooks/                       前端 hooks
├─ lib/
│  ├─ agents/                   Agent 编排和各阶段实现
│  ├─ conversation-store.ts     浏览器本地会话保存
│  ├─ llm-client.ts             传统单路聊天/Agent 失败回退
│  └─ llm-config.ts             对话模型配置解析
├─ public/                      Logo 和静态资源
├─ rag-service/
│  ├─ app.py                    FastAPI 服务，提供 /health 和 /search
│  ├─ ingest.py                 PDF/TXT 入库与 SQLite 存储实现
│  ├─ config.py                 RAG 配置和路径解析
│  ├─ migrate.py                SQLite 状态检查/幂等迁移工具
│  ├─ requirements.txt          Python 生产依赖
│  ├─ db/migrations/            保留的 schema/migration SQL
│  ├─ loaders/                  PDF、表格、图片解析
│  ├─ retrieval/                BM25、向量检索、RRF 和可选 reranker
│  ├─ knowledge/                本地知识文件；Git 默认不提交
│  ├─ vector_store/chroma/      历史目录名；实际存放 SQLite store.db
│  └─ static/images/            入库时生成的图片资源
├─ .env.example                 唯一环境变量模板
├─ .gitignore
├─ package.json
├─ package-lock.json
└─ README.md                    唯一部署文档
```

## 3. Agent 模块说明

`lib/agents/` 中各模块作用如下：

- `query-analyzer.ts`：识别问题类型、关键词并生成 RAG 检索词。
- `rag-client.ts`：调用 Python RAG 服务的 `/search`。
- `knowledge-answer-agent.ts`：从检索片段提取可核验的资料锚点。
- `general-answer-agent.ts`：用通用工程知识补足解释和建议。
- `answer-judge-agent.ts`：融合资料锚点和通用回答，生成最终答案结构。
- `answer-orchestrator.ts`：按顺序编排完整 Agent 流程及降级逻辑。
- `format-final-answer.ts`：转为网页纯文本并隐藏内部状态、来源和置信度。
- `llm-agent-client.ts`：统一调用 OpenAI-compatible 对话模型并控制各阶段输出长度。
- `types.ts`：Agent 内部数据类型。

不要在生产页面改用 `/api/chat-agent`，也不要把 Agent 中间 JSON 直接返回给用户。

## 4. 当前数据库和检索方案

当前生产代码不依赖 ChromaDB。实际方案是：

```text
SQLite store.db
  ├─ chunks              文本、元数据和 embedding
  ├─ chunks_fts          SQLite FTS5 全文索引
  ├─ documents           文档登记
  ├─ search_logs         检索运行日志
  ├─ tables              PDF 表格数据
  └─ images              PDF 图片数据

检索：BM25/FTS5 + 可选向量余弦 + RRF + 可选 reranker
```

默认文件位置：

```text
rag-service/vector_store/chroma/store.db
```

`chroma` 和 `CHROMA_PERSIST_DIRECTORY` 是历史兼容名称，不表示当前仍使用 `chromadb` 包。请不要重新引入 ChromaDB，也不要把旧 Chroma 的 `chroma.sqlite3`、`data_level0.bin` 等文件当成当前索引。

当前交付索引使用 `EMBEDDING_PROVIDER=simple_hash`。该模式完全离线，生产检索主要使用 SQLite FTS5/BM25；哈希 embedding 只用于保持入库格式兼容，不参与语义向量排序。若以后明确切换到真正支持 `/v1/embeddings` 的服务，必须使用相同 embedding 配置重新 ingest 整个索引，不能混用不同维度的旧数据。

## 5. 环境要求

### 5.1 Node.js

推荐 Node.js 20（至少 20.9）或 22，npm 10+。项目 `package.json` 已限制为 Node 20/22，不建议使用 Node 16 或未经验证的更高主版本。

在 PowerShell 中检查：

```powershell
node -v
npm -v
where.exe node
where.exe npm
```

如果已安装 Node 22，但 `node -v` 仍显示 16，通常是系统 `PATH` 中存在多个 Node。以 `where.exe node` 的第一条结果为准，删除或后移旧路径，然后关闭并重新打开终端。PowerShell 中应使用 `where.exe`，不要使用会与 PowerShell alias 混淆的 `where`。

### 5.2 Python

推荐 64 位 CPython 3.10、3.11 或 3.12。不要使用 3.13 作为首次生产部署版本。

```powershell
python --version
where.exe python
py -0p
```

如果 `python` 指向 Microsoft Store alias 或错误版本，可明确使用 `py -3.12`、`py -3.11` 或目标 Python 的绝对路径创建虚拟环境。

## 6. 环境变量

项目根目录只使用一个实际配置文件 `.env`。首次部署：

```powershell
cd C:\cssc-rag_agent
Copy-Item .env.example .env
notepad .env
```

生产必须确认以下配置：

```env
NODE_ENV=production

MOCK_MODE=false
LLM_PROVIDER=deepseek
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

ANSWER_MODE=agent
AGENT_ENABLE_GENERAL_ANSWER=true
AGENT_ENABLE_JUDGE=true
AGENT_ALLOW_GENERAL_FALLBACK=true
AGENT_SHOW_SOURCES=never
AGENT_SHOW_CONFIDENCE=false
AGENT_SHOW_KNOWLEDGE_STATUS=false

RAG_API_URL=http://127.0.0.1:3001
RAG_SERVICE_PORT=3001
RAG_DEFAULT_TOP_K=3

CHROMA_PERSIST_DIRECTORY=./rag-service/vector_store/chroma
KNOWLEDGE_PATH=./rag-service/knowledge
EMBEDDING_PROVIDER=simple_hash
```

长回答的当前生产预算位于 `.env.example`：

```env
AGENT_MAX_OUTPUT_TOKENS=8000
AGENT_KNOWLEDGE_MAX_OUTPUT_TOKENS=4000
AGENT_GENERAL_MAX_OUTPUT_TOKENS=7000
AGENT_JUDGE_MAX_OUTPUT_TOKENS=8000
AGENT_LONG_ANSWER_MAX_CHARS=16000
AGENT_ENABLE_LONG_ANSWER=true
```

`.env` 和 `.env.local` 不得提交 GitHub。修改 `.env` 后必须重启 Next.js 和 Python 服务。

## 7. Python 虚拟环境

项目根目录没有 `.venv`。Python 虚拟环境固定在 `rag-service/.venv`。

### 7.1 PowerShell 推荐方式

不激活环境，直接调用其中的 Python 最稳定：

```powershell
cd C:\cssc-rag_agent\rag-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

公司网络访问 PyPI 较慢时：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 7.2 PowerShell 激活方式

```powershell
cd C:\cssc-rag_agent\rag-service
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

PowerShell 不要使用 `activate.bat`，也不要双击 `Activate.ps1`。

### 7.3 cmd 激活方式

```cmd
cd /d C:\cssc-rag_agent\rag-service
.venv\Scripts\activate.bat
```

## 8. knowledge、ingest 和索引

### 8.1 输入和输出

`ingest.py` 递归读取：

```text
rag-service/knowledge/**/*.pdf
rag-service/knowledge/**/*.txt
```

写入：

```text
rag-service/vector_store/chroma/store.db
rag-service/static/images/       仅在 PDF 图片提取启用时生成
```

`app.py` 启动时读取同一个 `store.db`。路径由根 `.env` 中的 `CHROMA_PERSIST_DIRECTORY` 决定。

### 8.2 模式 A：携带现有索引

适用于当前已验证索引、知识库未变化的正式部署。U 盘中同时携带：

```text
rag-service/knowledge/
rag-service/vector_store/chroma/store.db
```

复制后直接启动 `app.py`，不需要 ingest。GitHub 默认不包含这些生产数据，因此从 GitHub 下载的纯代码不能替代完整 U 盘运行包。

### 8.3 模式 B：服务器重新 ingest

仅携带 `knowledge`、没有 `store.db`，或知识库内容已经更新时执行：

```powershell
cd C:\cssc-rag_agent\rag-service
.\.venv\Scripts\python.exe ingest.py
```

普通首次 ingest 不需要 `--drop`。`python ingest.py --drop` 会删除整个现有检索目录后全量重建，只能在已备份并明确确认要覆盖索引时使用。

不要在没有备份的情况下删除 `knowledge`、`vector_store` 或 `store.db`。

### 8.4 embedding 404

DeepSeek 官方对话 API 用于 `LLM_*` 聊天配置，但当前不提供项目所需的 OpenAI-compatible `/v1/embeddings`。把 `OPENAI_BASE_URL` 指向 DeepSeek 并启用 `openai_compatible` embedding 会返回 404。

当前正确的离线配置是：

```env
EMBEDDING_PROVIDER=simple_hash
```

只有在拥有真正支持 `/v1/embeddings` 的服务并准备全量重建索引时，才改为：

```env
EMBEDDING_PROVIDER=openai_compatible
OPENAI_API_KEY=
OPENAI_BASE_URL=https://实际支持-embeddings-的地址/v1
OPENAI_EMBEDDING_MODEL=实际模型ID
```

## 9. 本地开发启动

终端 1，启动 RAG：

```powershell
cd C:\cssc-rag_agent\rag-service
.\.venv\Scripts\python.exe app.py
```

终端 2，启动前端：

```powershell
cd C:\cssc-rag_agent
npm install
npm run dev
```

访问：

```text
http://localhost:3000
```

## 10. Windows Server 正式部署

### 10.1 准备 U 盘运行包

保留源码、`.env.example`、`knowledge` 和已验证的 `store.db`。不要携带：

```text
.git/
node_modules/
.next/
rag-service/.venv/
__pycache__/
*.pyc
*.log
*.err.log
tsconfig.tsbuildinfo
```

`.env` 含真实密钥，建议在服务器现场从 `.env.example` 创建；如必须随 U 盘转移，应按公司密钥介质要求保管，不能上传 GitHub。

### 10.2 部署顺序

1. 把项目复制到 `C:\cssc-rag_agent`。
2. 检查 Node、npm、Python 版本和 PATH。
3. 从 `.env.example` 创建并填写 `.env`。
4. 创建 `rag-service/.venv` 并安装 requirements。
5. 确认已有 `store.db`；只有缺失或知识更新时才运行 ingest。
6. 启动 `rag-service/app.py`。
7. 检查 `/health`，确认 `status=ok` 且 `chunks>0`。
8. 根目录执行 `npm install`。
9. 清除旧 `.next` 后执行 typecheck 和 build。
10. `npm start`，浏览器访问服务器 IP 的 3000 端口。

对应命令：

```powershell
cd C:\cssc-rag_agent
node -v
npm -v
where.exe node
where.exe npm
python --version
where.exe python
py -0p

Copy-Item .env.example .env
notepad .env

cd C:\cssc-rag_agent\rag-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

另开 PowerShell 检查 RAG：

```powershell
curl.exe http://127.0.0.1:3001/health
```

确认返回包含：

```json
{"status":"ok","database":"...\\store.db","chunks":"大于0"}
```

再开一个 PowerShell 构建前端：

```powershell
cd C:\cssc-rag_agent
npm install
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run typecheck
npm run build
npm start
```

`npm run build` 没有成功时不要执行 `npm start` 并声称部署成功。

## 11. 端口和防火墙

```text
3000  Next.js 网页，需要向公司客户端开放
3001  Python RAG，只监听 127.0.0.1，不需要向外开放
```

在管理员 PowerShell 中开放 3000：

```powershell
netsh advfirewall firewall add rule name="CSSC Agent 3000" dir=in action=allow protocol=TCP localport=3000
```

检查端口：

```powershell
netstat -ano | findstr :3000
netstat -ano | findstr :3001
```

## 12. 生产验收

RAG 健康检查：

```powershell
curl.exe http://127.0.0.1:3001/health
```

前端构建门禁：

```powershell
npm run typecheck
npm run build
```

网页至少测试：

```text
桩基检测需要注意什么？
泥沙对桩基检测有什么影响？
详细介绍水平荷载桩的受力特点、检测方法和注意事项。
```

验收标准：页面和 `/api/chat` 正常；回答有流式呈现；Agent 和 RAG 无异常；长回答不明显截断；页面不展示内部 JSON、raw chunks、OCR 路径、知识库未命中状态或置信度；浏览器控制台没有持续错误。

## 13. 常见问题

### 13.1 安装了 Node 22，但 `node -v` 仍是 16

```powershell
where.exe node
where.exe npm
```

`PATH` 中旧 Node 排在前面。调整系统环境变量后关闭并重新打开终端。

### 13.2 build 报 `Cannot find module '../../../app/api/route.js'`

这是旧 `.next` 类型缓存，不要创建无意义的 `app/api/route.ts`。执行：

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
```

不要复制其他电脑生成的 `.next`。

### 13.3 `npm start` 报 `Could not find a production build`

构建不存在或失败。先解决 `npm run build`：

```powershell
npm run build
npm start
```

### 13.4 PowerShell 执行 `.venv\Scripts\activate.bat` 失败

`.bat` 是 cmd 用法。PowerShell 使用：

```powershell
cd C:\cssc-rag_agent\rag-service
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

也可以完全不激活，直接运行 `.\.venv\Scripts\python.exe app.py`。

### 13.5 `Activate.ps1` 找不到

```powershell
cd C:\cssc-rag_agent\rag-service
Test-Path .\.venv\Scripts\Activate.ps1
```

如果是 `False`：

```powershell
python -m venv .venv
```

### 13.6 pip 很慢或尝试本机编译

先升级 pip，再安装固定版本依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

核心依赖使用 Windows wheel，正常不需要 Visual C++ 编译器。项目默认不安装 `sentence-transformers`、PyTorch 或 PaddleOCR。若使用不受支持的 Python 版本/架构，pip 可能找不到 wheel；请改用 64 位 Python 3.10-3.12。

### 13.7 ingest 报 embedding 404

检查 `EMBEDDING_PROVIDER`。当前生产索引使用：

```env
EMBEDDING_PROVIDER=simple_hash
```

不要把 DeepSeek 对话 API 当作 embedding API。不要为解决 404 重新引入 ChromaDB。

### 13.8 `chunks=0`

先检查只读状态：

```powershell
cd C:\cssc-rag_agent\rag-service
.\.venv\Scripts\python.exe migrate.py --status
Test-Path .\vector_store\chroma\store.db
Get-ChildItem .\knowledge
```

如果 U 盘应携带现有索引，重新复制 `store.db`。如果确实没有索引但有 knowledge，再运行普通 `python ingest.py`。不要直接使用 `--drop`。

### 13.9 页面打开但不能回答

依次检查：

- 根 `.env` 中 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 和 `ANSWER_MODE=agent`。
- `curl.exe http://127.0.0.1:3001/health` 是否正常。
- 浏览器 Network 中 `/api/chat` 的 HTTP 状态。
- 服务器是否能访问配置的大模型 API。
- 修改 `.env` 后是否重启了前后端。

### 13.10 GitHub 下载后 RAG 为空

GitHub 仓库不提交 `knowledge`、`vector_store` 和运行数据库。使用完整 U 盘运行包，或在服务器准备 knowledge 后重新 ingest。

## 14. 正式长期运行

临时演示可使用两个 PowerShell 窗口分别运行 Python RAG 和 `npm start`。

长期运行建议由公司运维把 Next.js 交给 PM2 或 Windows service，把 Python 交给 NSSM 或 Windows service，并配置自动重启、日志轮转和反向代理。本项目未直接引入 PM2/NSSM，3001 也不应对公网开放。

## 15. Git 和安全

提交前执行：

```powershell
git status
git diff --cached
git remote -v
```

不得提交：

```text
.env
.env.local
node_modules/
.next/
rag-service/.venv/
rag-service/knowledge/
rag-service/vector_store/
*.db
*.sqlite*
*.log
agent_answer.txt
```

`rag-service/db/migrations/` 是源代码和 schema，必须保留。`knowledge` 和 `store.db` 也必须保留在本地/U 盘运行包中，只是不进入 GitHub。

目标远程仓库：

```text
https://github.com/xuyuanyuanyuan/xuyuanyuanyuan_qianduan.git
```

禁止 force push。GitHub 连接失败时先运行：

```powershell
Test-NetConnection github.com -Port 443
```

网络恢复后再执行当前分支对应的普通 `git push origin <branch>`。
