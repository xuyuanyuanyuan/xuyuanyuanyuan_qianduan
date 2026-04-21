# 工程AI助手前端

本项目是一个基于 Next.js 的聊天前端，同时已扩展为“RAG + DeepSeek/OpenAI 兼容模型”的混合检索系统。

- 浏览器本地聊天记录存储
- `Mock` 模式
- `DeepSeek`
- `OpenAI` 兼容接口
- 本地 RAG PDF 检索服务

当前模型配置统一收敛到 `lib/llm-config.ts`，聊天请求封装在 `lib/llm-client.ts`，RAG 服务相关逻辑位于 `rag-service/`。

## 快速启动

1. 安装前端依赖：

```bash
npm install
```

2. 安装 RAG 服务依赖：

```bash
python -m pip install -r rag-service/requirements.txt
```

3. 复制环境变量模板：

```bash
cp .env.example .env
```

4. 编辑 `.env`，填入你的模型和 RAG 服务配置。

5. 放置需要检索的 PDF 到 `rag-service/knowledge/`。

6. 执行 PDF 入库：

```bash
python rag-service/ingest.py
```

7. 启动 RAG 服务：

```bash
python rag-service/app.py
```

8. 启动前端服务：

```bash
npm run dev
```

9. 浏览器访问：

```bash
http://localhost:3000/
```

## RAG 服务说明

RAG 服务目录：`rag-service/`

- `rag-service/app.py`：FastAPI 服务，提供 `/health` 和 `/search`
- `rag-service/ingest.py`：扫描 `knowledge/` 下所有 PDF、抽取文本、切分、向量化并写入 Chroma
- `rag-service/config.py`：本地配置读取逻辑
- `rag-service/requirements.txt`：Python 依赖
- `rag-service/vector_store/`：Chroma 本地持久化目录
- `rag-service/knowledge/`：存放待检索 PDF 的目录

### 放置 PDF

将待检索的 PDF 文件放在：

```text
rag-service/knowledge/
```

支持多个 PDF 文件，脚本会递归扫描子目录。

### 执行入库

```bash
python rag-service/ingest.py
```

如果需要重新构建向量库，可添加参数：

```bash
python rag-service/ingest.py --drop
```

### 启动 RAG 服务

```bash
python rag-service/app.py
```

默认监听端口为 `8001`，可通过 `.env` 中的 `RAG_SERVICE_PORT` 覆盖。

## Next.js 聊天接口

聊天接口已改造成“RAG + DeepSeek/OpenAI 兼容模型”流程：

1. 前端发送用户消息到 `/api/chat`
2. 服务端提取最后一条用户问题
3. 调用 Python RAG 服务的 `/search` 接口获取 top_k 相关片段
4. 组装严格的 system prompt，优先依据知识库内容回答
5. 调用 DeepSeek 或 OpenAI 兼容模型生成答案
6. 如果 RAG 服务不可用，则优雅降级到直接模型回答，并提示“知识库检索暂不可用”

前端消息区支持展示参考来源信息，包含文件名和页码。

## 环境变量

根目录 `.env.example` 包含前端和 RAG 服务所需的环境变量。

### 前端环境变量

- `MOCK_MODE`
- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_TEMPERATURE`
- `LLM_MAX_TOKENS`
- `LLM_TOP_P`
- `RAG_SERVICE_URL`
- `RAG_TOP_K`

### RAG 服务环境变量

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_EMBEDDING_MODEL`
- `EMBEDDING_PROVIDER`
- `LOCAL_EMBEDDING_MODEL`
- `RAG_SERVICE_PORT`
- `CHROMA_PERSIST_DIRECTORY`
- `KNOWLEDGE_PATH`
- `RAG_DEFAULT_TOP_K`

## 推荐目录结构

```text
app/
  api/chat/route.ts          # 聊天路由，处理 RAG 检索与模型调用
  page.tsx                   # 聊天页面 UI
components/
  ...                        # UI 组件
lib/
  llm-config.ts              # 模型配置与环境变量解析
  llm-client.ts              # 统一模型请求封装
  mock-chat.ts               # Mock 响应实现
  conversation-store.ts      # 本地会话存储
rag-service/
  app.py                     # FastAPI RAG 服务入口
  ingest.py                  # PDF 入库与检索逻辑
  config.py                  # RAG 服务环境配置
  requirements.txt           # Python 依赖
  knowledge/                 # 存放待检索 PDF 的目录
  vector_store/              # Chroma 向量数据库存储目录
```

## 详细启动流程（完整版）

### 第一次启动（完整设置）

#### Step 1: 克隆项目与安装依赖

```bash
# 进入项目目录
cd cssc_agent

# 安装 Node.js 依赖
npm install

# 创建 Python 虚拟环境（不污染系统 Python）
cd rag-service
python -m venv .venv

# 激活虚拟环境
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 安装 Python 依赖
pip install -r requirements.txt

cd ..
```

#### Step 2: 配置环境变量

```bash
# 复制示例配置
cp .env.example .env
```

编辑 `.env`，填入：

```env
# 前端配置
MOCK_MODE=false
LLM_PROVIDER=openai_compatible
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.deepseek.com/v1
# 或 https://api.openai.com/v1（如使用 OpenAI）
LLM_MODEL=deepseek-chat  # 或 gpt-4o-mini

# RAG 服务配置
RAG_SERVICE_URL=http://localhost:8001
RAG_TOP_K=3

# RAG 服务 Python 配置
OPENAI_API_KEY=your_embedding_api_key  # 可用同一个 API 密钥
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
RAG_SERVICE_PORT=8001
```

#### Step 3: 放置 PDF 文件

```bash
# 将 PDF 文件放入知识库目录
cp /path/to/your/document.pdf ./rag-service/knowledge/
```

支持的结构：
```
rag-service/knowledge/
├── document1.pdf
├── document2.pdf
└── subfolder/
    └── document3.pdf
```

#### Step 4: 执行 PDF 入库

```bash
cd rag-service

# 激活虚拟环境（如未激活）
# .venv\Scripts\activate  # Windows
# source .venv/bin/activate  # macOS/Linux

# 扫描 knowledge/ 下所有 PDF，转换为向量片段
python ingest.py
```

**输出示例：**
```
处理 PDF：document1.pdf
处理 PDF：document2.pdf
完成：共处理 2 个文档，生成 215 个向量片段。
```

#### Step 5: 启动 RAG 服务

新开一个终端：

```bash
cd rag-service

# 激活虚拟环境
# .venv\Scripts\activate  # Windows
# source .venv/bin/activate  # macOS/Linux

# 启动服务
python app.py
```

**输出示例：**
```
INFO:     Uvicorn running on http://0.0.0.0:8001
INFO:     Application startup complete
```

#### Step 6: 启动前端服务

新开第三个终端：

```bash
# 在项目根目录
npm run dev
```

**输出示例：**
```
  ▲ Next.js 15.0.0
  - LOCAL:        http://localhost:3000/
```

#### Step 7: 打开浏览器测试

访问 `http://localhost:3000/`，尝试提问与 PDF 相关的问题。

---

## 最小可运行版本（快速体验）

如果你只想快速体验，不需要完整 PDF 库：

### 最小版本流程（仅需 5 分钟）

```bash
# 1. 安装前端依赖
npm install

# 2. 复制环境变量
cp .env.example .env

# 3. 编辑 .env，填写 API 密钥（至少填写 LLM_API_KEY）

# 4. 前端直接启动（无需 RAG）
npm run dev

# 5. 访问 http://localhost:3000/ 即可使用聊天功能
```

**效果：** 聊天正常工作，但无法使用 PDF 知识库检索（因为 RAG 服务未启动）。前端会优雅降级，提示"知识库检索暂不可用"。

当需要 RAG 功能时，再按"详细启动流程"中 Step 3-5 添加 PDF 和启动 RAG 服务。

---

## 常见问题

### 1. 聊天界面报错"知识库检索暂不可用"

**原因：** RAG 服务未启动或 URL 配置错误

**解决：**
```bash
# 检查 RAG 服务是否启动
python rag-service/app.py

# 访问测试
curl http://localhost:8001/health

# 检查 .env 中 RAG_SERVICE_URL 是否为 http://localhost:8001
```

### 2. Python 虚拟环境问题

**问题现象：** `python: command not found` 或 poetry/pip 异常

**解决：**
```bash
# 升级 pip
python -m pip install --upgrade pip

# 确保 Python 版本 >= 3.11
python --version

# 重新创建虚拟环境
rm -rf rag-service/.venv
cd rag-service
python -m venv .venv
```

### 3. PDF 入库异常

**问题现象：** `OPENAI_API_KEY 未配置`

**解决：**
```bash
cd rag-service
# 检查 .env 文件是否有 OPENAI_API_KEY
cat .env | grep OPENAI_API_KEY

# 确保密钥正确
export OPENAI_API_KEY=your_key
python ingest.py
```

### 4. 向量检索返回为空

**原因：** 知识库为空或 PDF 未处理

**解决：**
```bash
# 确认 PDF 文件是否在 knowledge/ 下
ls rag-service/knowledge/

# 重新执行入库
python rag-service/ingest.py --drop
```

### 5. 端口被占用

**问题现象：** `Address already in use :8001` 或 `:3000`

**解决：**
```bash
# Windows: 查看占用端口的进程
netstat -ano | findstr :8001

# macOS/Linux: 查看占用端口的进程
lsof -i :8001

# 修改 .env 中的端口号，重启服务
# 或杀死旧进程
```

---

## 环境隔离设计

本项目严格隔离了 Node.js 和 Python 环境：

| 环境 | 位置 | 隔离方式 |
|------|------|--------|
| Node.js | 项目根目录 | npm / package.json |
| Python | rag-service/ | venv / requirements.txt |

**优点：**
- 依赖完全独立，不会污染系统 Python
- 便于团队协作和 CI/CD 部署
- 容易切换或升级某个环境

**使用指南：**
- 修改前端依赖：编辑根目录 `package.json`
- 修改 RAG 依赖：编辑 `rag-service/requirements.txt`
- 两个环境各自管理，互不影响

---

## 技术栈

| 模块 | 技术 | 说明 |
|------|------|------|
| 前端 | Next.js 15 | React 框架，SSR/SSG 支持 |
| UI | Tailwind CSS + Radix | 像素风格组件库 |
| 状态管理 | localStorage | 本地会话存储 |
| LLM | OpenAI-compatible API | DeepSeek、OpenAI 等兼容接口 |
| RAG | FastAPI | Python 后端服务 |
| 向量库 | Chroma | 本地持久化向量存储 |
| PDF 处理 | PyMuPDF | 高性能 PDF 提取 |
| Embedding | OpenAI-compatible | 兼容多种 embedding 服务 |

---

## 部署建议

### 本地开发

按"详细启动流程"操作即可。

### 服务器部署（生产）

1. **环境准备**
   ```bash
   # 安装 Python 3.11+
   python --version
   
   # 安装 Node.js 18+
   node --version
   ```

2. **克隆项目并安装依赖**
   ```bash
   git clone <repo> cssc_agent
   cd cssc_agent
   npm ci  # 使用锁定版本
   
   cd rag-service
   python -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env，填入正式 API 密钥与服务地址
   ```

4. **执行 PDF 入库**
   ```bash
   cd rag-service
   .venv/bin/python ingest.py
   ```

5. **使用 systemd/supervisor 启动服务**
   ```bash
   # 示例：RAG 服务 systemd 配置
   # /etc/systemd/system/rag-service.service
   [Unit]
   Description=RAG Service
   After=network.target
   
   [Service]
   Type=simple
   WorkingDirectory=/path/to/cssc_agent/rag-service
   ExecStart=/path/to/cssc_agent/rag-service/.venv/bin/python app.py
   Restart=always
   
   [Install]
   WantedBy=multi-user.target
   ```

6. **Nginx 反向代理**
   ```nginx
   server {
       listen 80;
       server_name example.com;
       
       # 前端
       location / {
           proxy_pass http://localhost:3000;
       }
       
       # RAG 服务（内部访问，不暴露）
       # 由 Node 后端内部调用 http://localhost:8001
   }
   ```

---

## 许可证

MIT
