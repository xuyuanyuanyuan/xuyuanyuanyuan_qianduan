# 工程AI助手前端

本项目是一个基于 Next.js 的聊天前端，支持本地对话存储、Mock 模式以及接入真实大模型 API。

## 一、快速启动

1. 安装依赖（如 npm 较慢建议先切换源）：

npm config set registry [https://registry.npmmirror.com](https://registry.npmmirror.com)
npm install

2. 启动项目：

npm run dev

3. 浏览器访问：

[http://localhost:3000](http://localhost:3000)

---

## 二、Mock 模式（无需 API）

用于测试页面和交互逻辑。

打开文件：

lib/api-config.ts

修改：

export const MOCK_MODE = true

保存后刷新页面即可使用模拟回复。

---

## 三、接入真实 API

1. 关闭 Mock：

export const MOCK_MODE = false

2. 在项目根目录创建文件：

.env.local

3. 填写 API Key（OpenAI 兼容接口）：

OPENAI_API_KEY=你的key

4. 如使用 DeepSeek / vLLM / 自建接口，可修改：

app/api/chat/route.ts

将：

const openai = createOpenAI({
apiKey: process.env.OPENAI_API_KEY,
})

改为：

const openai = createOpenAI({
apiKey: process.env.OPENAI_API_KEY,
baseURL: "你的接口地址"
})

5. 修改模型名称（可选）：

lib/api-config.ts

export const MODEL_NAME = "gpt-4o-mini"

---

## 四、数据存储

聊天记录保存在浏览器 localStorage 中：

engineering-ai-conversations
engineering-ai-current-chat

如需清空，可在浏览器控制台执行：

localStorage.clear()

---

## 五、常见问题

1. 依赖安装慢
   npm config set registry [https://registry.npmmirror.com](https://registry.npmmirror.com)

2. 端口被占用
   taskkill /PID xxxx /F

3. 无返回结果
   检查 MOCK_MODE、API key 和 baseURL 是否正确

4. Node 版本
   建议使用 Node 20 LTS

---

## 六、使用说明

拿到本项目后，只需：

1. npm install
2. 配置 .env.local
3. 设置 MOCK_MODE

即可运行或接入自己的模型。