# Anjian 交付目标

将 Ryugi v1.51.2 分叉为独立维护的 Anjian（案间）：中文个人工作台、本地数据、自主构建、无官方 Cloud 或包自动更新依赖，并提供可验证的 Dokploy 部署和 Agent 反馈闭环。

## 基线与授权

- 基线：`6054b65ab9b2208a234a78632eb065cfeb3eb166`（v1.51.2）。
- 本地分支：`work/local-first`，上游只读 remote 为 `upstream`。
- 已授权实现、创建公开仓库、提交推送及 Dokploy 部署。公开仓库：https://github.com/yusixian/anjian；首个 Anjian 提交为 `4186785b6dd2c775b2b760eb119e7793b6b17aad`。
- 来源和 MIT / AGPL 许可证须保留；不合入后续授权不明的上游代码。

## 当前阶段

本地改造已推送 main，首次 GitHub CI 全部通过（run 42359161802）。Dokploy 首次镜像构建正在执行。

已确认用户需要 `main` 的 push（含合并 PR）自动触发 Dokploy 部署。已登录 Dokploy；现有 `moe-prompt-atlas` 应用保持不变。用户已确认公开仓库 `yusixian/anjian`，正式域名 `anjian.cosine.ren` 与 `anjian-preview.cosine.ren`；已授权创建仓库、推送与部署。

## 完成条件

- [ ] Anjian 品牌和来源说明一致，实际命令不再依赖官方 npm 最新版。
- [ ] 无官方 Cloud 登录、发布、中继、自动更新调用；本地存储不碰 Ryugi 目录。
- [ ] 画板、文档、HTML 和评论流程通过真实浏览器验证（桌面与手机）。
- [ ] Agent 能读取批注并更新作品；本地与远程连接方式明确且验证。
- [x] 构建、类型和受影响测试通过。
- [ ] Docker 镜像、HTTPS、持久化与重启行为经过验证。
- [ ] 在访问与部署条件满足后，Dokploy 实例可访问并完成验收。

## 已有证据（2026-11-07）

- 本地完整构建通过，类型检查通过，git diff --check 通过。
- 完整测试集限制 4 个 worker 复查：160 个文件、1,373 项全部通过（71.53 秒）。使用已构建产物，配置为 `/tmp/anjian-server-vitest.config.ts`；此前无并发限制的一轮有两项 5 秒超时，定向复查也通过。
- 真实浏览器：语言切换为 English 后刷新保留 `anjian.locale=en`；中文首页展示三类作品；HTML 按钮计数从 0 更新为 1；画板桌面与 390px 手机预览正常，手机页面无横向溢出。
- 文档闭环：浏览器选中文字批注，CLI 读到对应 thread/block，修改 doc.xml 后网页实时更新，CLI 回复显示为 Codex 回复。
- 服务端 HTTPS publicOrigin/boardOrigin、非 loopback Board 监听与 Host 限制已有定向回归验证。真实 HTTPS 反代尚未验证。
- Docker Compose 静态解析通过；Docker Desktop 启动失败：dockerd 无法连接 `/run/containerd/containerd.sock`（timeout），日志确认 daemon 已退出。镜像尚未构建；未重置 Docker 数据。
- GitHub 仓库 yusixian/anjian 已创建，公开且默认分支为 main。Dokploy 项目 `yhOw9_JJM0dLXu2abBvfc`、环境 `j72NLQOKyxDyUtbwRTPm6`、Compose `S73UF2n-BFdnrkrW5qXyK`，应用名 `anjian-anjian-gxizee`。已配置 main、On Push、Autodeploy、两个 HTTPS origin 和分别指向 27319/27329 的域名路由；首次构建已启动，尚待容器与线上验收。

## 后续

验证 Docker 镜像、重启持久化和双来源反代。按用户选择准备 GitHub 与 Dokploy 新应用，明确本地 Agent 连接远程工作目录的方式，验证 main webhook 部署。当前只证明同机反馈闭环，不证明远程文件同步或宿主自动唤醒成功。
