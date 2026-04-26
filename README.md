# 工程AI助手 - 前端

基于 Next.js 的聊天应用，支持本地 RAG 知识库检索。

## 主要特性

- 聊天记录本地存储
- DeepSeek / OpenAI 兼容接口
- 本地 RAG PDF 知识库检索
- Mock 模式支持（离线演示）

## 快速开始 (开发)

```bash
npm install
cp .env.example .env
# 编辑 .env，填入 API 密钥
npm run dev  # http://localhost:3000
```

## 生产部署

详见 [DEPLOY_WINDOWS.md](DEPLOY_WINDOWS.md) - 阿里云 Windows Server 部署指南

**快速命令：**
```bash
npm install
npm run build
PORT=3000 npm start
```

## 项目结构

```
app/               # Next.js 应用
components/        # React 组件
lib/              # 工具与配置
rag-service/      # Python RAG 后端（可选）
```

## 环境变量

详见 `.env.example`。主要配置：
- `LLM_API_KEY` - 模型 API 密钥
- `RAG_API_URL` - RAG 服务地址（如使用本地知识库）
- `PORT` - 服务端口（默认 3000）

## 功能说明

### 聊天功能
- 支持持久化对话历史
- 支持 Mock 模式（无需 API）
- 支持流式响应

### 知识库 (可选)
- 本地 PDF 文件检索
- 自动向量化与分段
- 参考来源显示

## 常见问题

### 聊天界面报错"知识库检索暂不可用"

**原因：** RAG 服务未启动或 URL 配置错误

**解决：**
```bash
# 检查 RAG 服务是否启动
python rag-service/app.py

# 访问测试
curl http://localhost:3001/health
```

### 端口被占用

**Windows 查看占用端口：**
```bash
netstat -ano | findstr :3001
netstat -ano | findstr :3000
```

## 技术栈

| 项 | 技术 |
|----|------|
| 前端框架 | Next.js 16 |
| UI 组件 | Tailwind CSS + Radix |
| 状态管理 | localStorage |
| LLM | OpenAI-compatible API |
| RAG 后端 | FastAPI (可选) |

## 许可证

MIT
