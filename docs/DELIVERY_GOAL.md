# Anjian 交付目标

将 Ryugi v1.51.2 分叉为独立维护的 Anjian（案间）：中文个人工作台、本地数据、自主构建、无官方 Cloud 或包自动更新依赖，并提供可验证的 Dokploy 部署和 Agent 反馈闭环。

## 基线与授权

- 基线：`6054b65ab9b2208a234a78632eb065cfeb3eb166`（v1.51.2）。
- 本地分支：`work/local-first`，上游只读 remote 为 `upstream`。
- 已授权实现、创建公开仓库、提交推送及 Dokploy 部署。公开仓库：https://github.com/yusixian/anjian；首个 Anjian 提交为 `4186785b6dd2c775b2b760eb119e7793b6b17aad`。
- 来源和 MIT / AGPL 许可证须保留；不合入后续授权不明的上游代码。

## 当前阶段

本地改造已推送 main，首次 GitHub CI 全部通过（run 42359161802）。Dokploy 首次镜像构建成功，容器运行与 HTTPS 文档访问已验证。随后推送 `e74e1fa78ee8859a4e4485c98626813c5ede7b17` 自动触发第二次部署，记录显示 Done（51 秒）；该次构建使用缓存且未替换容器；随后单独重启容器并刷新网页，文档、批注和 Agent 回复均保留。

已确认用户需要 `main` 的 push（含合并 PR）自动触发 Dokploy 部署。已登录 Dokploy；现有 `moe-prompt-atlas` 应用保持不变。用户已确认公开仓库 `yusixian/anjian`，正式域名 `anjian.cosine.ren` 与 `anjian-preview.cosine.ren`；已授权创建仓库、推送与部署。

## 完成条件

- [x] Anjian 品牌和来源说明一致，实际命令不再依赖官方 npm 最新版。
- [x] 无官方 Cloud 登录、发布、中继、自动更新调用；本地存储不碰 Ryugi 目录。
- [x] 画板、文档、HTML 和评论流程通过真实浏览器验证（桌面与手机）。
- [ ] Agent 能读取批注并更新作品；本地与远程连接方式明确且验证。
- [x] 构建、类型和受影响测试通过。
- [x] Docker 镜像、HTTPS、持久化与重启行为经过验证。
- [x] 在访问与部署条件满足后，Dokploy 实例可访问并完成验收。

## 已有证据（2026-11-07）

- 本地完整构建通过，类型检查通过，git diff --check 通过。
- 完整测试集限制 4 个 worker 复查：160 个文件、1,373 项全部通过（71.53 秒）。使用已构建产物，配置为 `/tmp/anjian-server-vitest.config.ts`；此前无并发限制的一轮有两项 5 秒超时，定向复查也通过。
- 真实浏览器：语言切换为 English 后刷新保留 `anjian.locale=en`；中文首页展示三类作品；HTML 按钮计数从 0 更新为 1；画板桌面与 390px 手机预览正常，手机页面无横向溢出。
- 文档闭环：浏览器选中文字批注，CLI 读到对应 thread/block，修改 doc.xml 后网页实时更新，CLI 回复显示为 Codex 回复。
- 服务端 HTTPS publicOrigin/boardOrigin、非 loopback Board 监听与 Host 限制已有定向回归验证。主界面与线上画板真实 HTTPS 访问已验证。画板 iframe 来源为 `https://anjian-preview.cosine.ren`，主页面读取 contentDocument 返回 null；390px 手机视口页面宽度与 scrollWidth 均为 390，WebSocket 状态为已连接。
- Docker Compose 静态解析通过；Docker Desktop 启动失败：dockerd 无法连接 `/run/containerd/containerd.sock`（timeout），日志确认 daemon 已退出。未重置本机 Docker 数据；随后已在 Dokploy 完成真实 Linux 镜像构建。
- GitHub 仓库 yusixian/anjian 已创建，公开且默认分支为 main。Dokploy 项目 `yhOw9_JJM0dLXu2abBvfc`、环境 `j72NLQOKyxDyUtbwRTPm6`、Compose `S73UF2n-BFdnrkrW5qXyK`，应用名 `anjian-anjian-gxizee`。已配置 main、On Push、Autodeploy、两个 HTTPS origin 和分别指向 27319/27329 的域名路由；首次镜像构建完成，容器 `anjian-anjian-gxizee-anjian-1` 运行。无密钥访问返回 403；已认证的状态接口返回 200、版本 0.1.0、中文界面。

- 线上文档 `deployment-check` 已通过网页写入批注；容器内 CLI 读取同一 thread/block 并回复，网页实时显示 Agent 回复。此证据来自 Dokploy 容器终端，不代表电脑到服务器的 SSH 连接已验证。
- 推送 `e74e1fa` 后，Dokploy 自动生成对应完整 SHA 的部署记录并完成；已确认 main webhook 生效。随后通过 Dokploy Restart 重启容器，运行时长回到 1 秒；刷新网页后文档、批注及回复均保留。尚未验证容器替换和备份恢复。

- 线上 HTML 验收作品按钮由 0 更新为 1，iframe 未授予 allow-same-origin，contentDocument 为 null。HTML 使用主站 URL 的不透明来源沙箱；画板使用独立预览域名，两条路径已分别检查。
- 网络恢复后，远端 main 已核验为 `b42516c0b6cd2840699f401aee6cc75f5e1bfdd9`；CI run `42361944422` 成功，Dokploy 对应部署 Done（53 秒）。前一提交 b5fb2c6 的 CI 有一项 document-server 测试等待拒绝警告超时；最新运行通过，尚未定位该次超时根因。
- 画板验收配置声明 interactive 后，网页实时出现播放按钮；点击播放后，作品按钮由 0 更新为 1。普通画板默认禁用 iframe 指针交互。

## 后续

用户已明确选择 HTTPS API + CLI，不再以 SSH 作为产品连接要求。剩余必需项：完成浏览器设备授权、独立凭证与项目权限、冲突保护的上传/拉取、批注监听续接的本地和线上验收。容器重启持久化已验证；容器替换与备份恢复未验证，作为额外运维验收保留。当前已证明本机及服务器容器内的反馈闭环，不证明本地电脑到服务器的文件同步或宿主自动唤醒成功。

## HTTPS CLI 实现阶段

用户要求直接做到日常可用的程度，已授权实现与原 Anjian 项目内的交付延续。设计见 `docs/design/remote-api.md`，使用说明见 `docs/remote-cli.md`。

- 设备配对、项目授权、90 天凭证、网页撤销：已实现，服务端只保存摘要。
- 项目绑定、push/pull、comment/check、watch、logout：已实现，正在检查并发写入与真实浏览器流程。
- 新增远程 API 与已有 Hub 集成，设备授权、跨项目拒绝、版本冲突、撤销、重启后的事件续接、每设备批注游标和特殊资源名均有回归测试。
- 2026-11-07 主代理完整复查：165 个测试文件、1,405 项全部通过（67.25 秒）；复用上一轮完整构建产物，应用源码未改变。类型检查与 `git diff --check` 通过。前一轮的两项测试前提错误已修正。
- 实现已提交为 `152a159`，测试修正为 `74074fe`。独立分支 `feature/remote-cli` 的推送因 GitHub TLS 连接中断失败，远端分支与 CI 尚未建立。
- 本地浏览器验收服务的两次启动因自动权限审核超时而未执行；已请求用户明确授权后重试，尚未完成真实浏览器配对及本地到远程同步闭环。
- 远程 API 尚未部署；当前生产版本仍为 79ce753。不得将自动化测试通过视为浏览器验收或生产上线完成。
