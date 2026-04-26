# RAG Service - 本地 PDF 知识库检索服务

这是一个独立的 Python FastAPI 服务，提供本地 PDF 文档的向量化存储和检索功能。

## 快速开始

### 1. 环境搭建

在 `rag-service/` 目录下建立 Python 虚拟环境（**不污染主项目**）：

```bash
cd rag-service

# Windows
python -m venv .venv
.venv\Scripts\activate

# macOS/Linux
python -m venv .venv
source .venv/bin/activate
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env`，并填写以下内容：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置 embedding 服务：

```env
# OpenAI-compatible API (优先推荐)
EMBEDDING_PROVIDER=openai_compatible
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# 注意：需要提供真正支持 /v1/embeddings 的兼容服务
# DeepSeek 官方 API 适合对话模型，不适合作为当前项目的 embedding 源
```

### 4. 放置 PDF 文件

将 PDF 文件放在 `knowledge/` 目录下：

```bash
rag-service/
├── knowledge/
│   ├── document1.pdf
│   ├── document2.pdf
│   └── 子目录/
│       └── document3.pdf
```

### 5. 执行 PDF 入库

运行入库脚本，将 PDF 转换为向量片段并存储到 Chroma：

```bash
# 首次入库
python ingest.py

# 清空现有向量库后重新入库
python ingest.py --drop
```

**输出示例：**
```
处理 PDF：document1.pdf
处理 PDF：document2.pdf
完成：共处理 2 个文档，生成 253 个向量片段。
```

### 6. 启动 RAG 服务

```bash
python app.py
```

服务将在 `http://127.0.0.1:3001` 启动（可通过 `.env` 的 `RAG_SERVICE_PORT` 修改）

**注意：** 仅在本机可访问。如需跨网络访问，在 `app.py` 中改 `host="0.0.0.0"`。

---

## API 接口文档

### 1. 健康检查

```http
GET /health
```

**响应：**
```json
{
  "status": "ok",
  "storage": "/absolute/path/to/vector_store",
  "knowledge": "/absolute/path/to/knowledge"
}
```

### 2. 文档检索

```http
POST /search
Content-Type: application/json

{
  "query": "请帮我总结桩基的检测方法",
  "top_k": 3
}
```

**参数：**
- `query` (string, required): 检索查询
- `top_k` (int, optional): 返回结果数，默认 3

**响应示例：**
```json
{
  "results": [
    {
      "content": "桩基检测主要包括静载荷试验...",
      "source": "桩基设计规范.pdf",
      "page": 45,
      "score": 0.15
    },
    {
      "content": "声波透射法是一种无损检测方法...",
      "source": "工程检测方法.pdf",
      "page": 128,
      "score": 0.22
    }
  ]
}
```

**字段说明：**
- `content`: 检索到的文本片段
- `source`: 来源 PDF 文件名
- `page`: 页码（从 1 开始）
- `score`: 相似度分数（越小越相似）

也支持 GET 请求：
```http
GET /search?query=桩基检测&top_k=3
```

---

## 配置详解

### 环境变量 (.env)

| 变量名 | 说明 | 默认值 |
|--------|------|-------|
| `EMBEDDING_PROVIDER` | embedding 提供商 (`openai_compatible`) | `openai_compatible` |
| `OPENAI_API_KEY` | OpenAI 兼容 API 密钥 | 必须填写 |
| `OPENAI_BASE_URL` | OpenAI 兼容服务的 base URL | `https://api.openai.com/v1` |
| `OPENAI_EMBEDDING_MODEL` | 使用的 embedding 模型 | `text-embedding-3-small` |
| `RAG_SERVICE_PORT` | 服务启动端口 | `3001` |
| `KNOWLEDGE_PATH` | PDF 知识库目录 | `./rag-service/knowledge` |
| `CHROMA_PERSIST_DIRECTORY` | 向量库存储位置 | `./rag-service/vector_store/chroma` |

---

## 前端集成

Next.js 前端在调用大模型时，会首先调用本服务的 `/search` 接口获取相关文档片段，然后拼接到 prompt 中。

**流程：**

```
用户消息 → Next.js 后端 → RAG /search 
         → 获取相关文档 → 拼接 prompt 
         → 调用 DeepSeek/OpenAI → 返回答案
```

参考来源信息会在前端显示。

---

## 常见问题

### Q1: 启动时提示"OPENAI_API_KEY 未配置"

**解决：** 在 `.env` 中正确配置 `OPENAI_API_KEY` 或修改为其他兼容服务的 API 密钥。

### Q2: 入库报错"知识库目录不存在"

**解决：** 确保 `knowledge/` 目录存在，并至少放入一个 PDF 文件。

### Q3: 能否使用本地 embedding 模型？

目前仅支持 OpenAI 兼容的 embedding API。本地模型支持计划中。

### Q4: 多个 PDF 中有相同内容，会不会重复存储？

**不会。** 每条向量片段有唯一 ID（基于文件名 + 页码 + 块索引）。重复运行 `ingest.py` 会自动去重。

### Q5: 如何删除某个 PDF 的向量？

目前需要运行 `python ingest.py --drop` 清空所有，然后删除对应 PDF 文件后重新入库。

---

## 项目结构

```
rag-service/
├── app.py                    # FastAPI 主服务
├── ingest.py                 # PDF 入库脚本
├── config.py                 # 配置管理
├── requirements.txt          # Python 依赖
├── .env.example              # 环境变量示例
├── README.md                 # 本文件
├── .venv/                    # Python 虚拟环境（不提交）
├── knowledge/                # 放置 PDF 文件
└── vector_store/             # Chroma 向量库存储
    └── chroma/               # Chroma 数据库
```

---

## 故障排查

### 启动后无法连接

检查端口是否被占用：
```bash
# Windows
netstat -ano | findstr :3001

# macOS/Linux
lsof -i :3001
```

### Chroma 数据库锁定

如果看到类似错误：`Database is locked`

1. 确保只有一个 `app.py` 进程在运行
2. 删除 `vector_store/chroma/.lock` 文件（如果存在）
3. 重启服务

---

## 部署建议

### 生产环境

1. **隔离网络**：不暴露 RAG 服务到公网，仅 Next.js 后端可访问
2. **基础设施**：建议在同一台机器上运行，降低网络延迟
3. **监控**：添加日志和健康检查，定期检查 `/health` 端点
4. **备份**：定期备份 `vector_store/` 目录

---

## 许可证

与主项目相同。

---

## 扫描版 PDF OCR 接入说明

### 这一步的目的

这一步不是绕过现有 RAG 链路直接做问答，而是新增一个前置的数据准备步骤：

```
扫描版 PDF
→ OCR 提取文本
→ 基础清洗
→ 输出到 knowledge/ocr_book/*.txt
→ 执行 ingest.py 入库
→ 继续由 app.py / FastAPI 提供检索
```

也就是说，OCR 只是把扫描件先变成 `knowledge/` 下可继续入库的文本文件，后续仍然复用现有 `ingest.py`、Chroma 向量库和 `app.py`。

### PDF 应该放在哪里

建议把原始扫描版 PDF 直接放在 `rag-service/knowledge/` 下，例如：

```bash
rag-service/
├── knowledge/
│   ├── 你的书.pdf
│   ├── ocr_book/
│   └── 其他资料...
```

### 先只跑前 50 页

默认建议先只跑前 50 页调参，不要一开始直接整本跑：

```bash
cd rag-service

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

python ocr_to_knowledge.py --pdf "knowledge/你的书.pdf" --start-page 1 --end-page 50
```

如果你想显式指定输出目录，也可以这样：

```bash
python ocr_to_knowledge.py --pdf "knowledge/你的书.pdf" --start-page 1 --end-page 50 --output-dir "knowledge/ocr_book"
```

### OCR 输出会放到哪里

默认输出目录来自 `config.py` / `.env`：

```bash
knowledge/ocr_book/
```

脚本会逐页输出：

```bash
knowledge/ocr_book/page_0001.txt
knowledge/ocr_book/page_0002.txt
...
knowledge/ocr_book/ocr_report_p0001_p0050.json
```

每个 txt 文件会带页头，格式类似：

```text
[PAGE 1]

这里是 OCR 后并做过基础清洗的正文内容。
```

### OCR 之后如何入库

OCR 完成后，直接继续使用现有的入库脚本：

```bash
python ingest.py
```

当前 `ingest.py` 会递归读取 `knowledge/` 下的 `pdf` 和 `txt` 文件，因此 `knowledge/ocr_book/*.txt` 会自动被纳入知识库。

如果你想清空已有向量库后重新入库，可以继续使用原来的方式：

```bash
python ingest.py --drop
```

### 如何启动检索服务

入库完成后，可按现有方式启动服务：

```bash
python app.py
```

也可以在调试时使用：

```bash
uvicorn app:app --reload --port 8000
```

### 如何验证是否真的入库成功

可以按下面顺序检查：

1. 先打开 `knowledge/ocr_book/page_0001.txt`，确认里面不是空文件，而是能看到 OCR 提取后的正文。
2. 再查看 `knowledge/ocr_book/ocr_report_p0001_p0050.json`，确认 `successful_pages`、`failed_pages`、`suspected_empty_pages` 等统计是否合理。
3. 执行 `python ingest.py` 后，观察终端是否出现 `处理 TXT：...` 和 `Total chunks: ...`。
4. 启动服务后调用 `/search`，例如检索书里明确出现过的术语、规范编号或章节标题。

一个简单的检索示例：

```http
GET /search?query=桩基础&top_k=3
```

如果返回结果中的 `source` 指向 `ocr_book/page_00xx.txt`，并且 `page` 字段正确，就说明 OCR 文本已经进入知识库。

### 前 50 页效果确认后，如何扩展到整本书

如果前 50 页效果满意，再处理整本书：

```bash
python ocr_to_knowledge.py --pdf "knowledge/你的书.pdf" --start-page 1 --all-pages
```

然后再次执行：

```bash
python ingest.py
```

当前实现里，`ingest.py` 对同一个文档片段会使用稳定 ID 并执行 `upsert`，所以你先调试前 50 页、再扩展到全书时，不会因为重复页码直接把整个入库流程顶坏。

### 安装依赖与 PaddleOCR 注意事项

新增 OCR 功能后，需要在 `rag-service` 自己的虚拟环境内安装依赖：

```bash
pip install -r requirements.txt
```

`PaddleOCR` 在 Windows 本地常见的注意点是：

1. `paddleocr` 负责 OCR 流程，但底层还依赖 `paddlepaddle`。
2. `paddlepaddle` 的安装包和平台、Python 版本、CPU/GPU 组合相关，Windows 下请优先按 Paddle 官方说明安装与你当前环境匹配的版本。
3. 本项目这次改造没有改动 `.venv` 使用方式，也没有改动项目外部环境；请始终在 `rag-service/.venv` 中安装 OCR 依赖。

### 常见问题

#### 1. OCR 没识别出内容

优先检查：

- PDF 是否确实是扫描版而不是加密文件。
- `ocr_report_*.json` 里是否大量出现 `suspected_empty_pages`。
- 可以尝试增大渲染倍率，例如：

```bash
python ocr_to_knowledge.py --pdf "knowledge/你的书.pdf" --start-page 1 --end-page 50 --zoom 2.5
```

#### 2. 输出 txt 基本是空的

通常是下面几类原因：

- `paddleocr` 已装，但 `paddlepaddle` 没有装对。
- PDF 页面本身非常模糊、倾斜严重，导致 OCR 结果很差。
- 当前 `OCR_LANGUAGE` 不合适；中文资料建议优先使用 `ch`。

#### 3. ingest 后检索还是空

请依次检查：

- `python ingest.py` 是否真的处理到了 `knowledge/ocr_book/*.txt`。
- embedding 配置是否仍然可用。
- 是否检索了 OCR 文本里真实存在的关键词。
- 向量库里如果保留了旧数据，必要时可执行一次 `python ingest.py --drop` 后重建。

#### 4. PaddleOCR 安装报错

这是扫描 OCR 接入里最常见的问题，通常与 `paddlepaddle` 的平台轮子有关。建议做法：

- 先激活 `rag-service/.venv`
- 先安装与你当前平台匹配的 `paddlepaddle`
- 再执行 `pip install -r requirements.txt`
- 如果当前 Python 版本对应轮子暂时不可用，请以 Paddle 官方支持矩阵为准

### 推荐使用顺序

```bash
# 1. 先 OCR 前 50 页
python ocr_to_knowledge.py --pdf "knowledge/你的书.pdf" --start-page 1 --end-page 50

# 2. 再执行入库
python ingest.py

# 3. 再启动服务
uvicorn app:app --reload --port 8000
```
