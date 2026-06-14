# 部署指南 / Deployment Guide

> 将 OpenMAIC 量化交易系统部署到自有服务器（VPS / 云主机）。
> 适用版本：boris/ai4uclassroom fork（含量化交易模块）。

---

## 1. 系统要求

| 项目 | 最低 | 推荐 |
|---|---|---|
| **OS** | Ubuntu 22.04 / Debian 12 / macOS 14 | Ubuntu 24.04 LTS |
| **CPU** | 2 核 | 4 核+ |
| **内存** | 4 GB | 8 GB+（因子分析期间峰值 2-3 GB） |
| **磁盘** | 20 GB | 50 GB+（K 线缓存 + 模拟交易状态） |
| **Node.js** | 20.x | 22.x LTS |
| **包管理器** | pnpm 9+（推荐） | pnpm 9+ |
| **网络** | 可访问东方财富 / 新浪 / 腾讯（无墙） | 同 |
| **域名 + HTTPS** | 可选（仅 HTTP 也可本地用） | 推荐（微信/手机访问需要） |

---

## 2. 一键部署（推荐：Vercel）

> 最简方案，适合个人使用 / Demo / 移动端访问。

1. **创建 GitHub 仓库**（私有或公开）
2. **推代码**：
   ```bash
   git init
   git add .
   git commit -m "init: OpenMAIC + quant module"
   git branch -M main
   git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```
3. **Vercel 部署**：
   - 打开 https://vercel.com/new
   - Import 你的 GitHub 仓库
   - 配置环境变量（见下节）
   - 点 Deploy，5-10 分钟出 URL
4. **注意事项**：
   - Vercel 免费计划有 10s 函数超时 → 因子分析首次跑可能超时，建议先在本地跑一次预热 IDB
   - Vercel Serverless 是无状态的 → **模拟交易状态在 Vercel 上会丢**（每次冷启动重置）。生产用请用自托管

---

## 3. 自托管（推荐：完整模拟交易 + 长跑因子分析）

### 3.1 安装系统依赖

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y git curl build-essential

# macOS
brew install git
```

### 3.2 安装 Node.js

```bash
# 用 nvm（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 22
nvm use 22
node -v  # 确认 v22.x
```

### 3.3 克隆并安装依赖

```bash
git clone git@github.com:YOUR_USER/YOUR_REPO.git
cd YOUR_REPO
pnpm install
```

### 3.4 配置环境变量

```bash
cp .env.example .env.local
nano .env.local
```

最少需要配置（量化系统**不需要 LLM API key**——那是 OpenMAIC 聊天功能用的）：

```bash
# ===== 量化系统必要配置 =====
# 数据源代理（如在国内服务器部署东方财富被墙，可走代理）
HTTPS_PROXY=http://127.0.0.1:7890  # 可选

# 模拟交易状态存储目录（默认 ./data/simulator-state/，已 gitignore）
# QUANT_DATA_DIR=/var/lib/openmaic/quant-data

# Next.js 监听端口（默认 3000）
PORT=3000
```

**可选**（仅当你想用 AI 聊天 / 报告功能时）：

```bash
# LLM Provider（至少配一个）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### 3.5 构建 + 启动

```bash
# 生产构建
pnpm build

# 启动（前台）
pnpm start

# 或后台运行
nohup pnpm start > /var/log/openmaic.log 2>&1 &

# 或用 systemd（推荐）
sudo tee /etc/systemd/system/openmaic.service <<'EOF'
[Unit]
Description=OpenMAIC Quant Trading System
After=network.target

[Service]
Type=simple
User=openmaic
WorkingDirectory=/opt/openmaic
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=10
EnvironmentFile=/opt/openmaic/.env.local

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now openmaic
```

### 3.6 反向代理 + HTTPS（Nginx + Let's Encrypt）

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/openmaic
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 50M;  # 因子分析 POST 数据可能较大

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;  # 因子分析可能跑 30-60s
        proxy_send_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/openmaic /etc/nginx/sites-enabled/
sudo nginx -t
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

访问 `https://your-domain.com/quant` 即可。

---

## 4. 数据持久化

| 数据 | 存储位置 | 备份建议 |
|---|---|---|
| **用户账号 / 持仓 / 订单 / 成交** | `/data/simulator-state/<userId>.json` | 每天 cron rsync 到 OSS |
| **K 线 / 因子缓存** | `/data/quant-cache/`（如启用） | 同上 |
| **IndexedDB（浏览器侧镜像）** | 用户浏览器 | 无需服务端备份 |
| **Postgres / SQLite** | 如启用 ERP 模块 | 每日 pg_dump |

### 自动备份脚本

```bash
# /etc/cron.daily/backup-openmaic
#!/bin/bash
DATE=$(date +%Y%m%d)
tar czf /backup/openmaic-$DATE.tar.gz /opt/openmaic/data/simulator-state/
find /backup -name "openmaic-*.tar.gz" -mtime +30 -delete
```

---

## 5. 监控 + 告警

```bash
# 检查服务状态
systemctl status openmaic

# 看实时日志
journalctl -u openmaic -f

# 健康检查 endpoint（如已实现）
curl https://your-domain.com/api/health
```

**关键指标**：
- 内存：因子分析期间峰值 2-3 GB，配置 ≥4 GB swap
- 磁盘：每天增长 50-200 MB（K 线缓存），建议 50 GB+ 起步
- CPU：交易时段 9:30-15:00 高峰，平时空闲

---

## 6. 常见问题

### Q: 因子分析超时（30-60s）怎么办？
A: 是正常的，全市场 200 只股票 + IC 折算需要 30-60s。如经常超时：
- 减小 `limit` 参数（默认 80，调到 30）
- 关闭 `icHistory=1`（严谨 IC 模式更慢）
- 升级服务器（CPU 4 核+）

### Q: 东方财富 / 新浪接口 403 怎么办？
A: 服务器在国内，配置代理（`HTTPS_PROXY`）。或在代码层切换数据源（详见 `lib/quant/data/data-source.ts`）。

### Q: 模拟交易状态丢失？
A: 检查 `/data/simulator-state/<userId>.json` 是否存在。Next.js 重启会重置 in-memory 状态，状态恢复依赖文件加载逻辑（见 `lib/quant/store/simulator-state-store.ts`）。

### Q: 想跑 Docker？
A: 项目未自带 Dockerfile，可参考：
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
```

---

## 7. 升级

```bash
cd /opt/openmaic
git pull origin main
pnpm install
pnpm build
sudo systemctl restart openmaic
```

**数据兼容性**：本项目用 Dexie schema versioning，跨版本升级会自动迁移。如遇 IDB 错，可手动清浏览器端缓存：
```js
// 浏览器控制台
indexedDB.deleteDatabase('openmaic');
location.reload();
```

---

## 8. 联系方式

- **GitHub Issues**：https://github.com/boriswzb/ai4uclassroom/issues
- **作者邮箱**：swunwang@qq.com
- **Live Demo**：https://www.ai4uclassroom.com/quant
