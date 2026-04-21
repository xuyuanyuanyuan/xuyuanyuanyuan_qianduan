# RAG 工程化项目清单

## ✅ 已完成的全部工作

### 1. RAG 服务目录结构
```
rag-service/
├── app.py                      # ✅ FastAPI 主服务 (GET /health, POST /search)
├── ingest.py                   # ✅ PDF 入库脚本 (支持 --drop 参数)
├── config.py                   # ✅ 配置管理 (环境变量读取)
├── requirements.txt            # ✅ Python 依赖列表
├── .env.example                # ✅ 环境变量示例
├── README.md                   # ✅ RAG 服务详细文档
├── .venv/                      # Python 虚拟环境（使用时创建）
├── knowledge/                  # 📁 存放 PDF 文件
└── vector_store/
    └── chroma/                 # 📁 Chroma 向量库存储
```

### 2. 前端聊天接口集成
- ✅ `app/api/chat/route.ts` 已改造，集成 RAG 检索流程
- ✅ 支持 RAG 失败时优雅降级
- ✅ 前端提示参考来源信息（文件名 + 页码）

### 3. 配置文件
- ✅ `.env.example` - 前端 + RAG 服务环境变量
- ✅ `rag-service/.env.example` - RAG 专用环境变量示例
- ✅ `rag-service/config.py` - 集中配置管理

### 4. 文档
- ✅ `README.md` - 详细的完整启动流程 + 最小版本
- ✅ `rag-service/README.md` - RAG 服务完整文档

---

## 🚀 快速启动检查清单

### 第一次启动（一键跑通）

```bash
# 1️⃣ 安装前端依赖
npm install

# 2️⃣ 创建 Python 虚拟环境
cd rag-service
python -m venv .venv

# 3️⃣ 激活虚拟环境
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 4️⃣ 安装 Python 依赖
pip install -r requirements.txt

# 5️⃣ 返回根目录，复制环境变量
cd ..
cp .env.example .env

# 6️⃣ 编辑 .env，填写 API 密钥（至少填写 LLM_API_KEY）
# 推荐配置：
# - LLM_API_KEY=your_key
# - LLM_BASE_URL=https://api.deepseek.com/v1 (或 OpenAI)
# - OPENAI_API_KEY=same_or_different_key
# - OPENAI_BASE_URL=https://api.deepseek.com/v1

# 7️⃣ 放置 PDF 文件（可选）
cp /path/to/document.pdf rag-service/knowledge/

# 8️⃣ 执行 PDF 入库（如有 PDF）
cd rag-service
python ingest.py
cd ..

# 9️⃣ 启动 RAG 服务（新终端）
cd rag-service
.venv\Scripts\activate  # 或 source .venv/bin/activate
python app.py
# 输出：INFO: Uvicorn running on http://0.0.0.0:8001

# 🔟 启动前端服务（新终端）
npm run dev
# 输出：http://localhost:3000/

# 1️⃣1️⃣ 访问浏览器
# http://localhost:3000/
```

---

## 📋 环境变量配置要点

### 前端环境变量（.env）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `LLM_API_KEY` | 大模型 API 密钥（必须） | `sk-xxx` |
| `LLM_BASE_URL` | 大模型服务地址 | `https://api.deepseek.com/v1` |
| `LLM_MODEL` | 模型名称 | `deepseek-chat` 或 `gpt-4o-mini` |
| `RAG_SERVICE_URL` | RAG 服务地址 | `http://localhost:8001` |
| `RAG_TOP_K` | 检索结果数量 | `3` |
| `MOCK_MODE` | 是否使用 Mock | `false` |

### RAG 服务配置（rag-service/.env）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `OPENAI_API_KEY` | Embedding API 密钥 | `sk-xxx` |
| `OPENAI_BASE_URL` | Embedding 服务地址 | `https://api.deepseek.com/v1` |
| `OPENAI_EMBEDDING_MODEL` | Embedding 模型 | `text-embedding-3-small` |
| `KNOWLEDGE_PATH` | PDF 存放目录 | `./rag-service/knowledge` |
| `RAG_SERVICE_PORT` | RAG 服务端口 | `8001` |
| `CHROMA_PERSIST_DIRECTORY` | 向量库目录 | `./rag-service/vector_store/chroma` |

---

## 🔍 验证步骤

### 验证前端正常
```bash
curl http://localhost:3000/
# 应返回 HTML 页面
```

### 验证 RAG 服务正常
```bash
curl http://localhost:8001/health
# 应返回：{"status": "ok", "storage": "...", "knowledge": "..."}
```

### 验证 PDF 入库成功
```bash
# 进入 rag-service 目录
cd rag-service
python ingest.py
# 应输出：完成：共处理 X 个文档，生成 Y 个向量片段。
```

### 验证检索功能
```bash
curl -X POST http://localhost:8001/search \
  -H "Content-Type: application/json" \
  -d '{"query": "桩基检测方法", "top_k": 3}'
# 应返回 JSON 格式的检索结果，包含 content、source、page、score
```

---

## 📁 完整项目结构

```
cssc_agent/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts           # ✅ 聊天接口（集成 RAG）
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── chat-*.tsx
│   ├── pixel-*.tsx
│   └── ui/                        # UI 组件库
├── lib/
│   ├── llm-client.ts              # 模型调用封装
│   ├── llm-config.ts              # 配置管理
│   ├── conversation-store.ts      # 本地存储
│   └── ...
├── rag-service/                   # ✅ RAG 服务（独立）
│   ├── app.py                     # FastAPI 主服务
│   ├── ingest.py                  # PDF 入库脚本
│   ├── config.py                  # Python 配置
│   ├── requirements.txt           # Python 依赖
│   ├── .env.example               # 环境变量示例
│   ├── README.md                  # RAG 文档
│   ├── .venv/                     # Python 虚拟环境
│   ├── knowledge/                 # PDF 存放目录
│   └── vector_store/              # 向量库存储
├── public/
├── .env.example                   # ✅ 前端 + RAG 环境变量
├── README.md                      # ✅ 详细启动文档
├── package.json
├── tsconfig.json
└── ...
```

---

## ⚠️ 重要约束

1. **不影响前端依赖**：RAG 服务在独立的 `rag-service/.venv` 中运行
2. **相对路径**：所有配置使用相对路径，便于部署迁移
3. **环境隔离**：Python 和 Node.js 各自管理，互不污染
4. **本地可跑通**：无需 Redis、ES、云服务，开箱即用
5. **优雅降级**：RAG 失败时仍可直接调用大模型

---

## 🎯 下一步建议

1. **首次使用**：按"快速启动检查清单"逐步执行
2. **添加 PDF**：将文档放入 `rag-service/knowledge/` 后，运行 `python ingest.py`
3. **测试检索**：在聊天界面提问与 PDF 相关的内容，查看是否正确返回参考来源
4. **调整参数**：根据 `.env` 中的配置调整模型、embedding 服务等
5. **监控日志**：关注前端和 RAG 服务的日志输出，即时发现问题

---

## 📞 故障排查

| 症状 | 原因 | 解决方案 |
|------|------|--------|
| 聊天出现"知识库检索暂不可用" | RAG 服务未启动或 URL 配置错 | 检查 `/health` 端点 |
| PDF 入库报"OPENAI_API_KEY 未配置" | 环境变量未设置 | 编辑 `.env` 填写密钥 |
| 检索结果为空 | 知识库无 PDF 或入库失败 | 放 PDF 后重新 `python ingest.py` |
| 端口被占用 | 旧进程仍在运行 | 杀死进程或修改 `.env` 端口号 |
| Python 模块导入错 | 虚拟环境未激活 | 运行 `.venv\Scripts\activate` |

---

**项目已完全工程化，新人可按文档一键启动！** 🚀
