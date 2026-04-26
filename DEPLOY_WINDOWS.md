# 阿里云 Windows Server 部署指南

本文档说明如何将本项目部署到阿里云 Windows Server 实例。

## 前置要求

- Windows Server 2016 或更高版本
- Node.js 20.9+ (从 https://nodejs.org 下载安装)
- (可选) Python 3.11+ (如使用 RAG 知识库功能)

## 部署步骤

### 1. 准备环境

**安装 Node.js：**
- 访问 https://nodejs.org/
- 下载 LTS 版本 Windows Installer
- 运行安装程序，选择"Add to PATH"
- 验证安装：
  ```powershell
  node --version
  npm --version
  ```

### 2. 克隆/上传项目

在 Windows Server 上选择合适目录，例如 `C:\projects\`：

```powershell
# 使用 Git（推荐）
git clone https://github.com/xuyuanyuanyuan/xuyuanyuanyuan_qianduan.git
cd xuyuanyuanyuan_qianduan

# 或上传本地代码到 C:\projects\xuyuanyuanyuan_qianduan
```

注意：

- 可以用 U 盘复制整个项目目录到服务器。
- 但不要把“已可运行”建立在复制 `node_modules`、`.next` 或 `rag-service/.venv` 的前提上。
- 尤其是 `rag-service/.venv` 含有本机 Python 绝对路径，换机器后通常不具备可移植性，建议在服务器上重新创建虚拟环境并重装依赖。

### 3. 安装依赖

```powershell
npm install
```

### 4. 配置环境变量

```powershell
# 复制示例配置
copy .env.example .env
```

编辑 `C:\projects\xuyuanyuanyuan_qianduan\.env`，填入必需的配置：

```env
# 必需配置
PORT=3000
NODE_ENV=production

# LLM 配置（必需）
MOCK_MODE=false
LLM_PROVIDER=openai_compatible
LLM_API_KEY=your_llm_api_key_here
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# RAG 知识库（可选，如不使用留空）
RAG_API_URL=http://localhost:3001
RAG_TOP_K=3
```

如需启用 Python RAG 服务，还需要在服务器上重新准备 Python 环境：

```powershell
cd rag-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 5. 构建生产版本

```powershell
npm run build
```

如构建成功，你会看到：
```
✓ Compiled successfully
✓ Collecting page data
✓ Generating static pages
```

### 6. 测试运行

```powershell
# 前台运行测试
PORT=3000 npm start
```

浏览器访问 http://localhost:3000/ 验证功能。

按 `Ctrl+C` 停止服务。

### 7. 配置开机自启（推荐使用 PM2）

**安装 PM2：**
```powershell
npm install -g pm2
```

**创建 PM2 配置文件** `ecosystem.config.js`：
```javascript
module.exports = {
  apps: [
    {
      name: 'cssc-frontend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        LLM_API_KEY: 'your_key_here',
        LLM_BASE_URL: 'https://api.deepseek.com/v1',
        RAG_API_URL: 'http://localhost:3001'
      },
      instances: 1,
      instance_var: 'INSTANCE_ID',
      exec_mode: 'cluster'
    }
  ]
};
```

**启动服务：**
```powershell
pm2 start ecosystem.config.js
pm2 startup windows
pm2 save
```

**查看日志：**
```powershell
pm2 logs cssc-frontend
pm2 status
```

### 8. 创建 Windows 任务计划自启（如不使用 PM2）

如没有 PM2，可用 Windows 任务计划器：

1. 打开"任务计划程序"
2. 创建基本任务：
   - 名称：CSSC Frontend
   - 触发器：启动时
   - 操作：
     - 程序：`C:\Program Files\nodejs\node.exe`
     - 参数：`C:\projects\xuyuanyuanyuan_qianduan\node_modules\.bin\next start`
     - 工作目录：`C:\projects\xuyuanyuanyuan_qianduan`
   - 勾选"不论用户是否登录都要运行"

### 9. 配置端口转发（Windows 防火墙）

```powershell
# 允许应用通过防火墙
netsh advfirewall firewall add rule name="CSSC Frontend" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes

# 特定端口
netsh advfirewall firewall add rule name="Port 3000" dir=in action=allow protocol=tcp localport=3000 enable=yes
```

### 10. (可选) 配置反向代理（IIS）

如使用 IIS：

1. 安装 IIS 和 URL Rewrite 模块
2. 创建新网站，指向 `C:\projects\xuyuanyuanyuan_qianduan\public`
3. 创建 `web.config`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="ReverseProxyRule">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/{R:1}" />
                </rule>
            </rules>
        </rewrite>
    </system.webServer>
</configuration>
```

## 常见问题与排查

### npm install 失败

**症状：** 依赖安装时出错

**解决：**
```powershell
# 清除缓存
npm cache clean --force

# 重新安装
npm install
```

### npm run build 出错

**症状：** 构建失败

**解决：**
```powershell
# 检查 Node.js 版本
node --version  # 建议 20.9+

# 删除构建缓存
Remove-Item .next -Force -Recurse

# 重新构建
npm run build
```

### 服务无法启动

**症状：** npm start 报错或无响应

**解决：**
```powershell
# 检查端口占用
netstat -ano | findstr :3000

# 如被占用，更改 PORT 环境变量或杀死占用进程
taskkill /PID <PID> /F
```

### 连接 RAG 服务失败

**症状：** "知识库检索暂不可用"

**解决：**
```powershell
# 检查 RAG_API_URL 配置
Get-Content .env | findstr "RAG_API_URL"

# 测试 RAG 服务是否在线
Invoke-WebRequest http://localhost:3001/health

# 如需启用，在另一个终端启动 RAG 服务
cd rag-service
python app.py
```

### 查看实时日志

**使用 PM2：**
```powershell
pm2 logs cssc-frontend --lines 100
```

**使用 PowerShell：**
```powershell
Get-ChildItem .next/logs # 查看 Next.js 日志
```

## 备好关键文件对应表

| 文件 | 示例路径 | 说明 |
|------|---------|------|
| 项目根 | `C:\projects\xuyuanyuanyuan_qianduan\` | 核心目录 |
| 配置文件 | `.env` | 环境变量（不提交 Git） |
| 示例配置 | `.env.example` | 环保变量示列模板 |
| 构建输出 | `.next\` | 生产构建文件夹 |
| 日志 | `.next\logs\` 或 PM2 日志 | 诊断信息 |

## 性能优化建议

1. **启用 Gzip 压缩**（IIS 或代理层）
2. **配置 CDN**（可选，用于静态资源）
3. **监控内存使用**
   ```powershell
   tasklist /FI "IMAGENAME eq node.exe" /V
   ```
4. **定期更新依赖**
   ```powershell
   npm update
   ```

## 安全建议

1. **保护 .env 文件** - 设置文件权限，只允许应用程序访问
2. **使用强密钥** - 所有 API_KEY 使用强密码
3. **防火墙配置** - 仅允许必要端口，建议用负载均衡器
4. **定期备份** - 备份 `.env` 和数据库目录（如有）
5. **HTTPS** - 如公网访问，配置 SSL/TLS 证书

## 售后支持

如遇问题：
1. 检查日志：PM2 logs 或 Windows 事件查看器
2. 验证环境变量是否正确设置
3. 确保所有依赖已安装
4. 查看 github 项目的 issues

---

**部署完成后，访问 http://your-server-ip:3000 即可使用服务。**
