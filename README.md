<div align="center">

# Anjian · 案间

**给你和 AI Agent 用的开源作品工作台**

画板 · 文档 · HTML 预览 · 白板 · 幻灯片 · 分镜 · 本机运行与自托管

[在线文档](https://anjian.cosine.ren) · [English README](README.en.md) · [更新记录](https://anjian.cosine.ren/zh/docs/updates) · [GitHub Releases](https://github.com/yusixian/anjian/releases)

</div>

---

## 这是什么？

和 AI Agent 一起做设计、写技术方案或搭原型时，光靠聊天框很难看清效果，也没法指着某个按钮说「这里往左挪一点」。

**案间（Anjian）**把 Agent 生成的**画板、文档、HTML、白板、幻灯片和分镜**直接呈现在浏览器里：你在具体位置留下批注，Agent 通过本地 CLI 拉取评论、修改源文件、推送新版，再在原评论下回复。

## 核心功能

- **画板（Artboard）**：多页设计稿并排对比，支持缩放平移、元素图层与样式检查、定点批注、方案投票、验收打回、手机样机和交互原型。
- **文档（Document）**：富文本方案评审，支持划词评论、浏览器直接改字、引用其他作品与块定位、发起问答/批准、验收报告和历史差异对比。
- **HTML 预览**：在独立沙盒域里运行网页原型，边点交互边把选区反馈发给 Agent。
- **白板、幻灯片与分镜**：画流程图、带演讲者备注放演示文稿、剪辑分镜导出 MP4。
- **多宿主 Agent 集成**：内置 Skill（`anjian skills get artifacts`），支持 Claude Code、Codex（含审批与规划任务）、Pi、Antigravity、GitHub Copilot CLI、DeepSeek Harness 及自定义宿主。
- **公开分享与好友空间**：一键生成免登录只读快照链接，或通过 GitHub 邀请朋友拥有完全独立的工作空间。
- **本机优先 & 自托管**：提供 macOS / Linux 开箱安装包，也支持 Docker Compose / Dokploy 部署、共享容量管理与 S3 存储接入。

> 案间不连任何官方云服务，没有订阅，也不会自动下载上游包。所有数据都在你自己的电脑或服务器上。

---

## 快速开始

### 1. 本机安装（推荐：直接下载安装包）

到 [GitHub Releases](https://github.com/yusixian/anjian/releases) 下载对应系统的归档（已内置 Node.js，支持 macOS Apple Silicon / Intel 与 Linux x64 / arm64），校验 SHA-256 解压后运行：

```bash
./anjian start --project-dir /绝对路径/你的项目 --no-open --foreground
```

或从源码构建（需要 Git、Node.js 22 和 pnpm）：

```bash
git clone https://github.com/yusixian/anjian.git
cd anjian/artifacts
pnpm install --frozen-lockfile
pnpm build
node dist/cli.cjs start --project-dir /绝对路径/你的项目 --no-open --foreground
```

打开终端打印的完整 URL 即可进入工作台。详见 [安装说明](docs/install.md) 或 [在线文档](https://anjian.cosine.ren/zh/docs/local)。

### 2. 部署到自己的服务器

需要两个 HTTPS 域名（主站 `27319` + 画板隔离预览 `27329`）：

```bash
export ANJIAN_PUBLIC_ORIGIN=https://anjian.example.com
export ANJIAN_BOARD_ORIGIN=https://preview.example.net
docker compose up --build -d
```

反向代理、Dokploy 部署和 GitHub 登录配置见 [自托管部署](docs/self-hosting.md)。

### 3. 连接本地 CLI 与 Agent

```bash
# 查看内置 Skill 与当前绑定状态
anjian skills get artifacts
anjian remote status --json

# 配对远程工作台并绑定本地项目
anjian login https://你的案间域名 --name "我的电脑"
anjian link
anjian push --artifact html/hello
```

更多用法见 [远程 CLI](docs/remote-cli.md) 和 [在线 Agent 接入指南](https://anjian.cosine.ren/zh/docs/agent)。

---

## 文档导航

- [在线使用文档（中英双语）](https://anjian.cosine.ren)
- [macOS / Linux 安装包与源码构建](docs/install.md)
- [Docker / Dokploy 自托管](docs/self-hosting.md)
- [HTTPS 远程 CLI 与设备配对](docs/remote-cli.md)
- [CLI 命令速查](docs/artifacts-cli.md)
- [公开只读分享](docs/public-sharing.md)
- [作品多选与回收站](docs/artifact-trash.md)
- [成员管理与 S3 存储](docs/members-storage.md)
- [文档站本地预览与构建](website/README.md)
- [上游能力对照](docs/upstream-capabilities.md) · [阶段交付记录](docs/DELIVERY_GOAL.md)

## 来源与许可证

案间基于 [Innei/ryugi v1.51.2](https://github.com/Innei/ryugi/tree/v1.51.2)（提交 `6054b65ab9b2208a234a78632eb065cfeb3eb166`）分叉并独立维护，持续对照上游正式版本并按授权实现适合本地与自托管的能力。感谢 Innei 与 Ryugi 贡献者，也感谢 Jesse Vincent 与 [Superpowers](https://github.com/obra/superpowers) 贡献者；完整历史来源见 [UPSTREAM.md](UPSTREAM.md)。

- **Skills、集成与文档**：[MIT License](LICENSE)
- **`artifacts/` 应用及构建产物**：[AGPL-3.0-only](artifacts/LICENSE)
- **第三方依赖**：遵循各自开源协议

项目改名不改变继承代码的许可证；如修改后对外提供网络服务，须遵守 AGPL-3.0 的对应源码开放要求。
