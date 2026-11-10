# Anjian · 案间

面向个人使用的画板、文档与 HTML 作品工作台，以本地运行、中文体验和自主维护为方向。

本项目基于 [Innei/ryugi v1.51.2](https://github.com/Innei/ryugi/tree/v1.51.2) 分叉，独立演进。它不是 Ryugi 官方版本，也不以持续跟随上游功能或版本为目标。中文名称为「案间」，英文名称为 Anjian。

## 产品方向

- **个人使用**：围绕方案展示、文档批注、HTML 预览与 Agent 反馈整理使用流程。
- **本地优先**：作品与评论保存在自己控制的设备或服务器上；基本功能不要求第三方账号。
- **中文体验**：完善中文界面、错误提示和使用文档。
- **移除官方云服务**：已移除 Ryugi Cloud 登录、发布、云中继及官方包自动更新路径，使用本项目自行构建的程序。
- **可自行部署**：保留部署到自己的 Dokploy 的方向，单独处理 HTTPS、持久化、访问控制以及本地 Agent 与服务器之间的通信。

这里的“移除云端”指移除官方托管服务依赖；部署到自己控制的服务器仍属于项目目标。自建账号平台、订阅计费和公共云服务不在当前范围内。

## 当前状态

Anjian 已完成本地构建、独立命名空间与官方云端入口移除。初始语言为中文；保留手动语言选择。

2026-11-07 已验证：

- server、CLI、viewer、viewer library 与 runtime 完整构建和类型检查通过。
- 浏览器中文作品库、HTML 交互、桌面与手机画板预览可用。
- 浏览器文档批注 → CLI 读取 → 文件修改 → CLI 回复 → 网页实时同步的本地闭环通过。
- 限制 4 个 worker 的完整测试集通过：160 个文件、1,373 项测试。

Dokploy 已完成源码镜像构建和 HTTPS 文档访问验证；推送 main 已实际触发自动部署。线上文档批注与容器内 CLI 回复已互通。已验证容器重启后文档与评论保留；线上 HTML 沙箱与画板独立 HTTPS 来源已验证，手机画板无横向溢出。容器替换后的卷恢复未验证。2026-11-09 已完成 HTTPS 远程 CLI 的浏览器设备授权、文档同步与批注闭环、冲突保护和设备撤销验收。详见 [交付记录](docs/DELIVERY_GOAL.md)。

## 使用与开发

- [从源码构建和本地运行](docs/install.md)
- [CLI 命令](docs/artifacts-cli.md)
- [作品多选、回收站与恢复](docs/artifact-trash.md)
- [公开只读分享](docs/public-sharing.md)
- [通过 HTTPS 连接远程工作台](docs/remote-cli.md)
- [Agent 远程操作指引](skills/artifacts/remote.md)（新会话接入见 [安装说明](docs/install.md#agent-集成)）
- [Docker / Dokploy 自托管](docs/self-hosting.md)

## 开发起点

工作台源码位于 `artifacts/`，包含前端、服务端、CLI、构建脚本和测试；Agent skills 与适配脚本位于 `skills/`、`hooks/` 等目录。

优先从本地源码构建，不要把 `npx ryugi-artifacts` 当成本项目的安装命令：该命令获取的是上游发行包。

改造顺序：

1. 统一 Anjian 品牌、命令及文档，并保留来源署名。
2. 移除官方云服务和官方自动更新路径，验证本地内容与评论流程。
3. 完善中文体验和个人使用流程。
4. 提供 Docker / Dokploy 部署方式，验证数据持久化和 HTTPS 访问。
5. 接通本地 Agent 与自有服务器上的作品和评论；文件同步与会话通知需要分别验证。

仓库其他文档目前仍主要来自上游，可能包含官方安装、发布或云服务指引；这些尚不是本项目的操作说明。

## 来源与许可证

基线为 [Innei/ryugi v1.51.2](https://github.com/Innei/ryugi/tree/v1.51.2)，提交 `6054b65ab9b2208a234a78632eb065cfeb3eb166`。感谢 Innei 与 Ryugi 贡献者。Ryugi 的工作流又源自 Jesse Vincent 与贡献者维护的 [Superpowers](https://github.com/obra/superpowers)；历史来源见 [UPSTREAM.md](UPSTREAM.md)。

沿用此基线的许可证划分，并保留原有版权声明：

- Skills、集成与文档：见根目录 [MIT LICENSE](LICENSE)。
- `artifacts/` 应用及其构建产物：见 [AGPL-3.0-only](artifacts/LICENSE)。
- 第三方依赖遵循各自许可证；发布和部署前仍需核对其要求。

新的项目名称不改变继承代码的许可证。若向其他人提供修改后的网络服务，须遵守 AGPL 的对应源码提供要求。后续引入上游代码时应逐项核对该版本授权，不能假定仍适用本基线的许可证。
