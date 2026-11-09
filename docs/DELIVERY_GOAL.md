# Anjian 交付目标

将 Ryugi v1.51.2 分叉为独立维护的 Anjian（案间）：中文个人工作台、本地数据、自主构建、无官方 Cloud 或包自动更新依赖，并提供可验证的 Dokploy 部署和 Agent 反馈闭环。

## 基线与授权

- 基线：`6054b65ab9b2208a234a78632eb065cfeb3eb166`（v1.51.2）。
- 本地分支：`work/local-first`，上游只读 remote 为 `upstream`。
- 已授权实现、创建公开仓库、提交推送及 Dokploy 部署。公开仓库：https://github.com/yusixian/anjian；首个 Anjian 提交为 `4186785b6dd2c775b2b760eb119e7793b6b17aad`。
- 来源和 MIT / AGPL 许可证须保留；不合入后续授权不明的上游代码。

## 当前阶段

生产版本为 `72aedd996df52b4f247025a4f6fc020e635f0928`。功能分支 CI 42492693259 和 main CI 42493032249 均通过。2026-11-09 已核对 Dokploy 对应提交部署 Done（1m 40s）、容器 `7cc16a4f4657` 运行，并完成真实公网 HTTPS CLI 与浏览器验收。

已确认用户需要 `main` 的 push（含合并 PR）自动触发 Dokploy 部署。已登录 Dokploy；现有 `moe-prompt-atlas` 应用保持不变。用户已确认公开仓库 `yusixian/anjian`，正式域名 `anjian.cosine.ren` 与 `anjian-preview.cosine.ren`；已授权创建仓库、推送与部署。

## 完成条件

- [x] Anjian 品牌和来源说明一致，实际命令不再依赖官方 npm 最新版。
- [x] 无官方 Cloud 登录、发布、中继、自动更新调用；本地存储不碰 Ryugi 目录。
- [x] 画板、文档、HTML 和评论流程通过真实浏览器验证（桌面与手机）。
- [x] Agent 能读取批注并更新作品；本地与远程连接方式明确且验证。
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

## HTTPS CLI 交付验收（2026-11-09）

实现见 `docs/design/remote-api.md`，使用见 `docs/remote-cli.md`。用户选择 HTTPS API + CLI，不以 SSH 为产品使用条件。

- 本地完整回归 165 个文件、1,407 项通过；类型检查通过。功能分支与 main 的 GitHub CI 均通过。
- 实际浏览器管理员登录、设备配对批准、本地项目绑定、文档首次上传及块 ID 规范化通过。
- 网页选中文字批注后，本地 CLI watch 续接到 doc-comments 事件，comment list 读到批注；CLI 修改并 push、回复后，网页实时显示更新。
- 网页编辑后，旧基线 push 被冲突保护拒绝；pull 将网页新内容保存到本地。文档 check 无警告。
- 独立撤销测试设备经网页撤销后返回 HTTP 401，保留的主 E2E 设备仍可用。
- 文档在 390px 手机视口无横向溢出。HTML 和画板均经远程 CLI 上传，浏览器按钮从 0 变为 1；HTML 沙箱不授予 allow-same-origin，画板 iframe 来源为 anjian-preview.cosine.ren，两者 contentDocument 均不可由主页面读取。
- Dokploy 的部署 SHA 与 main 一致；新容器启动后原数据卷中的历史作品仍在。没有执行备份恢复测试。

### 保留的回归入口

专用设备 `anjian-production-e2e` 只授权当前 project，凭证保存在本机仓库外的私有目录，不提交 Git；可从「设备与 CLI」撤销。一次性 `anjian-e2e-revocation-check` 已撤销。

- 文档：https://anjian.cosine.ren/document/nQZyCiZ0kSYJz2QuS3eX9
- HTML：https://anjian.cosine.ren/html/AABMZq3JWddKfuANDDDlf
- 画板：https://anjian.cosine.ren/artboard/YSIjcKbNaRjbywkMwC7mQ

这些入口需要管理员浏览器登录。本轮是实际浏览器和 CLI 验收，保留了样例与设备；尚未建立 CI 自动执行的公网 E2E 套件。

### 后续改进与边界

- 该次公网验收时首次管理员登录仍需带访问密钥的链接；后续本地登录实现见下方条目，不能据此假设线上版本或其他浏览器已登录。
- 事件监听不会自行唤醒 Lody 或其他宿主 Agent；任务调度需另行集成。
- 备份恢复未验收。公网部署下的持续网络故障及服务重启事件恢复本轮未重复测试，自动化回归覆盖了事件日志重启续接。

## Agent 新会话接入（2026-11-09）

已补齐 `skills/artifacts/remote.md`、Skill 远程模式分流、三种作品的同步说明及仓库 AGENTS.md/安装模板。当前本机工作区另有无秘密的 AGENTS.md 指向已授权包装器。新上下文 Agent 的前后对照验证及实际只读命令核验见 [验证记录](agent-guide-verification.md)。仅当前工作区具备现成入口；其他宿主或项目仍需按安装模板加载指引，不代表全局 Skill 已安装或自动任务调度已接通。

## 浏览器登录（2026-11-09，已发布）

未登录访问作品库、作品和设备授权页时，跳转中文访问密钥登录页。支持错误密钥重试、可选记住设备 30 天、登录后回到原页面与配对码、状态面板退出，以及打开中的作品检测登录失效。沿用服务器管理员密钥，不引入账号密码或官方 Cloud；API 未授权仍返回失败，跨来源表单与外站回跳被拒绝。

- `pnpm typecheck` 通过；`pnpm test` 的全量构建及 166 个测试文件、1414 项测试通过。
- 本地隔离服务的真实 Chrome 验证通过：错误密钥不回显、作品路径与查询参数恢复、持久 Cookie 在新浏览器上下文恢复、退出清除 Cookie、390px 手机无横向溢出、配对码保留且仍需显式项目批准、凭据失效回到登录。无页面脚本错误。
- 登录表单页面使用 `Referrer-Policy: same-origin`，避免 Chrome 原生表单在 `no-referrer` 下发送 `Origin: null`；来源校验未放宽。HTTPS Cookie 的 Secure 属性有服务端回归覆盖。
- 实现提交 `e120c9a`，Linux 测试临时目录修正 `52c52ee`；后者已推送到 `main`。[发布前 CI](https://github.com/yusixian/anjian/actions/runs/42610628034) 通过：166 个测试文件、1411 项通过、3 项按平台跳过。
- Dokploy 自动部署 `JHBwcapUqAwF1YHCOVgs2` 完成，新容器 `836ba44a07ff` 运行正常，公网 `/login` 返回 200。真实 Chrome 验证设计稿链接回跳、错误密钥重试且输入不回显、390px 手机无横向溢出、设备配对码保留，以及未授权 API 仍返回 403，未发现页面脚本错误。
- 有效密钥登录、持久 Cookie 和退出已完成本地浏览器验收；本轮没有重测生产环境的有效密钥登录。自动审批拒绝了用于辅助读取容器终端的消息捕获，未继续读取生产密钥。

## 当前 Goal：本人 GitHub 登录（2026-11-09，已完成）

目标：让实例所有者 `yusixian`（GitHub 用户 ID `43498495`）通过 GitHub OAuth 登录线上案间，保留作品访问、设备授权与管理员备用入口；真实登录成功后才完成 Goal。

已确认当前没有用户表、成员角色或用户级项目权限。原管理员由服务器密钥识别，CLI 设备具有独立项目权限但没有所属用户。本轮只实现单 Owner 登录；多人登录、审批和统一成员管理留待后续设计，不能直接开放所有 GitHub 用户。

当前实现使用独立签名会话、state 和 PKCE，并把会话验证接入 Hub、挂载作品、独立服务和 WebSocket。类型检查通过；4 worker 全量回归为 1431 项通过、1 项既有 CLI 评论用例超时，该文件单 worker 复测 16 项全部通过。真实 Chrome 使用模拟 GitHub 验证桌面/390px 手机、跨站回调、独立持久会话、新浏览器恢复、退出、非 Owner 拒绝和失败保留配对码，均通过且无页面脚本错误。独立安全审查及修复窄复核通过。实现提交 `69a39a1` 已推送 main；功能分支 CI `42628815844` 和 main CI `42629409366` 均成功。Dokploy 部署 `imnDPn-TACS57R1oBgsDI` 完成，新容器运行。

外部配置：专用 OAuth 应用已在 `yusixian` 下创建（GitHub application ID `4005473`），固定回调地址为 `https://anjian.cosine.ren/auth/github/callback`。Client Secret 已保存于 Dokploy 环境，用户另存于 1Password；仓库不存储凭据。

生产验收：用户日常 Chrome 勾选“记住此设备 30 天”，进入 GitHub 仅请求公开身份信息的授权页；用户点击授权后，已确认返回线上作品库，7 个作品正常显示，随后设计画板也正常打开。既有 CLI 设备 `anjian-production-e2e` 的远程状态仍为 linked，项目绑定有效。生产没有使用其他账号尝试登录；非 Owner 拒绝、退出和会话恢复由自动测试及模拟提供方浏览器验收覆盖。

## 状态面板批注落实（2026-11-09）

应用现按服务器部署类型显示本地运行或自托管，日志面板统一主题样式并提供加载、失败重试和空状态，停止服务器前说明影响并要求确认。手机状态面板限制视口宽度，品牌名保持单行。设计稿原链接已同步并回复两条批注，尚未关闭线程。

本地类型检查及完整构建通过，相关 8 项测试通过；Chrome 深浅主题与 390px 手机验证筛选、错误重试、取消停止不发送请求、确认停止只发送一次请求和 Escape 关闭。测试使用隔离接口，不对生产发送停止请求。此记录为部署前验证，生产交付结果另行核验。

## 多选与回收站（2026-11-10，本地实现）

按长期设计稿 `bulk-manage` 页面实现作品多选、当前结果全选、Shift 连选、筛选变化清空选择、批量移入回收站、撤销、逐项恢复和永久删除确认。移动端使用固定底栏与至少 44px 的操作触区；中英文、浅色与暗色沿用现有组件和样式变量。

作品、批注和编辑状态一起保留 30 天，恢复维持原链接；同名冲突拒绝覆盖。删除前关闭项目写入会话并保存文档；删除与远程上传共用项目锁。清理后保留旧 ID 删除记录，避免 CLI 再次上传令作品自动出现。操作范围和备份注意事项见 [使用说明](artifact-trash.md)。

本轮本地验证：

- 完整构建通过；全量回归 171 个测试文件、1,455 项测试全部通过（`pnpm exec vitest run --maxWorkers=4`）。
- 类型检查与 `git diff --check` 通过。
- 回收站存储、HTTP 集成与请求分发的 21 项测试通过；覆盖首次 manifest 写入失败、恢复中断、到期清理、来源校验、重复请求、同名冲突和跨项目同名路由。
- 独立服务端审查发现的首次记录发布与跨项目路由问题均已修复，窄复核确认关闭。
- 隔离临时服务上的真实 Chrome 验证了取消、批量移入、撤销、恢复、永久删除二次确认、Ctrl+A、Esc、桌面和 390px 手机布局。手机主按钮实测高度 44px；暗色流程无页面脚本错误。
- 使用请求拦截注入单项失败和“服务端成功但响应丢失”，验证只重试失败项及查询真实回收站后确认成功；这两项是故障注入，不是公网故障测试。

此条目只记录本地实现和验证；尚未提交、推送或部署本轮功能，未删除线上作品。截图和浏览器脚本暂存在 `/tmp/anjian-bulk-*`，不作为长期归档。
