# 来源记录

本项目从 Innei/ryugi 的 `v1.51.2` 分叉，基线提交为 `6054b65ab9b2208a234a78632eb065cfeb3eb166`。案间以个人使用、本地运行和中文体验为主，独立发布并持续核对上游正式版本的能力。引入后续上游代码前，须单独核对其许可证和适用性。

以下保留 Ryugi 原有的 Superpowers 来源与迁移记录，供追溯使用；其中的远程名、发布基线和同步步骤并非本项目的更新策略。

## 当前对照版本

2026-11-24 核对 Ryugi 正式版 `v1.108.5`，最新提交 `4b20d0d7fe98cfca4f18f3871e55595b99a542d1`。相对 `v1.108.2` 新增 1 个公开提交，累计审计 231 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.108.5) · [增量差异](https://github.com/Innei/ryugi/compare/v1.108.2...v1.108.5)

- **选案批注**。案间让选案轮次开放时的普通批注立即通知已订阅作品的本地会话。选项点按保持安静，明确提交仍发送现有的一条选案摘要。同一轮的批注和提交若在一次扫描中到达，由提交通知引导 Agent 读取线程。
- **文档引用与分镜**。现有作品引用只支持画板组或卡片定位，新的文档块定位由 [#213](https://github.com/yusixian/anjian/issues/213) 跟踪。现有分镜可编辑并导出时间线，播放时钟、快捷键和旁白发音由 [#214](https://github.com/yusixian/anjian/issues/214) 独立验收。
- **来源与授权**。公开提交只改动版本清单，许可证文件未变。案间依据正式说明核对公开行为，本批使用案间现有监听器独立实现。官方云的登录和发布行为在案间产品范围之外。[许可证](https://github.com/Innei/ryugi/blob/v1.108.5/LICENSE)

### v1.108.2 的能力差异

2026-11-24 核对 Ryugi 正式版 `v1.108.2`，最新提交 `7a3ee3c018b399886a141f772322c6d6caa56352`。相对 `v1.108.1` 新增 3 个公开提交，累计审计 230 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.108.2) · [增量差异](https://github.com/Innei/ryugi/compare/v1.108.1...v1.108.2)

- **作品反馈隔离**。Codex 批注、HTML 选区和 Pi 监听状态通过定向回归。真实 DeepSeek Web 的两个同项目会话分别订阅两个文档，通知仅送达对应会话。无作品订阅时的项目级行为继续记录在 [#55](https://github.com/yusixian/anjian/issues/55#issuecomment-7125506843)。
- **文档连接**。正式 v0.18.10 的同机 Hub 在桌面和窄屏 Chrome 保持两条连接空闲 65 秒，之后编辑即时同步，刷新后仍可读回。跨设备 HTTPS 留在 [#177](https://github.com/yusixian/anjian/issues/177)。[回归证据](https://github.com/yusixian/anjian/issues/55#issuecomment-7125469560)
- **嵌入式宿主**。案间独立修复了 Pi、Antigravity、DeepSeek/Pi 反馈恢复和作品启动器的 Node 选择，编译的 Bun 宿主探针确认使用独立 Node。[实现 #210](https://github.com/yusixian/anjian/pull/210) · [宿主兼容 #165](https://github.com/yusixian/anjian/issues/165)
- **来源与授权**。公开差异包括 Hook 订阅逻辑、宿主入口和测试，许可证文件未变。本批采用案间现有入口和独立实现。[许可证](https://github.com/Innei/ryugi/blob/v1.108.2/LICENSE)

### v1.108.1 的能力差异

2026-11-24 核对 Ryugi 正式版 `v1.108.1`，最新提交 `6f5b4cc70c0493f4848a8ec1fa090258389eff08`。相对 `v1.108.0` 新增 2 个公开提交，累计审计 227 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.108.1) · [增量差异](https://github.com/Innei/ryugi/compare/v1.108.0...v1.108.1)

- **作品库刷新**。Ryugi 减少了跨项目列表的文件读取，并合并连续发布引发的刷新。案间已独立实现按项目缓存与可访问项目的合并变更流，两个项目各连续创建八份作品时分别只刷新一次。[实现 #183](https://github.com/yusixian/anjian/pull/183) · [浏览器证据 #180](https://github.com/yusixian/anjian/issues/180)
- **报告来源与侧栏空态**。案间验收报告可以预览通过校验的 JSON 数据表，并展开高亮原文。远程重跑授权与统一刷新继续由 [#152](https://github.com/yusixian/anjian/issues/152) 跟踪。Antigravity 无作品对话应留在侧栏空态，首次打开作品后再切换，归 [#166](https://github.com/yusixian/anjian/issues/166) 验收。[实现 #184](https://github.com/yusixian/anjian/pull/184)
- **来源与授权**。许可证文件未变。公开提交涉及 Antigravity 侧栏及其测试、发布清单。案间按发布行为独立核对。[许可证](https://github.com/Innei/ryugi/blob/v1.108.1/LICENSE)

### v1.108.0 的能力差异

2026-11-24 核对 Ryugi 正式版 `v1.108.0`，最新提交 `32cd13cd09753ecd72fba40aa6f8228f1c354183`。相对 `v1.107.0` 新增 2 个公开提交，累计审计 225 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.108.0) · [增量差异](https://github.com/Innei/ryugi/compare/v1.107.0...v1.108.0)

- **保留健康的源码 Hub**。发行版 CLI 复用仍响应的源码 Hub。监听配置冲突时提示用户先明确停止 Hub；失去响应时仍可替换。案间独立实现，CLI 与网页管理操作会追加简洁的 Hub 事件记录。[操作指南](website/content/docs/local.mdx#更新案间)
- **跨设备编辑**。Ryugi 的所有者可以从另一台设备编辑幻灯片、报告、分镜、白板和验收报告，并在版本不兼容时查看只读视图。案间通过自托管和项目权限提供跨设备访问，按作品类型核对编辑、保存和兼容提示。[跨设备验收 #177](https://github.com/yusixian/anjian/issues/177) · [报告重跑 #152](https://github.com/yusixian/anjian/issues/152)
- **来源与授权**。两版的 `LICENSE` 文件相同。公开增量包含版本清单和会话启动 Hook 的测试调整。本轮依据正式版公告独立实现。[许可证](https://github.com/Innei/ryugi/blob/v1.108.0/LICENSE)

### v1.107.0 的能力差异

2026-11-24 核对 Ryugi 正式版 `v1.107.0`，本批覆盖 `v1.106.1` 和 `v1.107.0`，最新提交 `c31f85a1caff86c95a1c58db2fac7ad7e88ce1c7`。相对 `v1.105.8` 新增 5 个公开提交，累计审计 223 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.107.0) · [增量差异](https://github.com/Innei/ryugi/compare/v1.105.8...v1.107.0)

- **Antigravity 桌面侧栏**。可选 Auxiliary Pane 打开对话的活跃作品，跟随作品切换并接收实时更新。案间已有 CLI 插件与专用反馈会话，桌面侧栏按 [#166](https://github.com/yusixian/anjian/issues/166) 核对，普通会话投递继续见 [#52](https://github.com/yusixian/anjian/issues/52)。
- **宿主运行状态**。Ryugi 在桌面左下角和手机顶部呈现统一的多会话状态。案间已有作品级 Agent 反馈连接，统一状态与浏览器会话交互合并在 [#151](https://github.com/yusixian/anjian/issues/151) 验收。
- **文档与手势**。Ryugi 开始监听打开文档后发现的嵌入，案间按 [#167](https://github.com/yusixian/anjian/issues/167) 验证现有动态内容和作品引用。双指手势按作品实际使用检查，保留浏览器缩放作为阅读辅助。
- **Hook 和 daemon**。Ryugi 提前安装按版本存放的 Hook，诊断显示可执行文件，进程名称包含角色和版本，并为 daemon 双端增加同一套协议样例。案间已交付可辨认的本机 Hub 和批注监听进程，见 [#133](https://github.com/yusixian/anjian/pull/133)。离线首次操作、Hook 诊断及协议边界见 [#165](https://github.com/yusixian/anjian/issues/165)。
- **来源与授权**。两版之间的 `LICENSE` 文件无变化。共核对 1 项分发改动、1 项宿主扩展、1 项发行说明 CI 改动及 2 项版本提交。本轮使用公开行为和提交范围作对照。[许可证](https://github.com/Innei/ryugi/blob/v1.107.0/LICENSE)

### v1.105.8 的能力差异

2026-11-24 核对 Ryugi 正式版 `v1.105.8`，本批覆盖自 `v1.103.0` 起的 15 个正式版，最新提交 `68cd84f11b6d935d9295f09d3b46ee17332918c9`。相对 `v1.102.9` 新增 28 个公开提交，累计审计 218 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.105.8) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.9...v1.105.8)

- **宿主反馈**。正式说明记录了 Codex Desktop Hook 授权和投递修复，以及 DeepSeek Harness 的 Skill 加载与批注回传。案间已有 Codex App Server 定向投递和通用宿主回执。桌面端授权、送达和 DSH 各自验收。[#150](https://github.com/yusixian/anjian/issues/150) · [#154](https://github.com/yusixian/anjian/issues/154)
- **浏览器任务与会话**。上游新增会话等待状态、浏览器与手机回复、多终端接入和文档任务编辑器。案间已有 Lody 评审任务与结果回传，浏览器首轮提示词、已有本地会话的待输入和受权交互作为独立工作核对。[#151](https://github.com/yusixian/anjian/issues/151)
- **画布和评审**。记录预览平移、删除和撤回、把删除位置交给 Agent、白板缩放点阵及幻灯片结构广播。验收报告涉及脚本重跑和新的页头、抽屉。按两个工作流验收。[#153](https://github.com/yusixian/anjian/issues/153) · [#152](https://github.com/yusixian/anjian/issues/152)
- **运行和发布**。上游把 Hook 改为签名的原生程序，并调整 daemon 发布缓存、源码身份、优先级和信任对话时序。案间按作品反馈、会话控制和可信制品轨迹验收任务。Linux 自产制品与 macOS 公证继续由 [#139](https://github.com/yusixian/anjian/issues/139) 和 [#124](https://github.com/yusixian/anjian/issues/124) 跟踪。官方云登录、更新及首次调用下载上游二进制不接入案间。
- **来源与授权**。Ryugi License 1.1 更新了内部使用条件，Exhibit B 保留特定早期 MIT 材料。本轮采用正式发布说明和公开差异做行为审计，新增实现按案间架构独立完成。[Ryugi License 1.1](https://github.com/Innei/ryugi/blob/v1.105.8/LICENSE)
- **DeepSeek Harness 实现来源**。Ryugi v1.103.3 的 `.dsh` 集成沿用 Ryugi License 1.1。案间以 DeepSeek 公布的原生命令和 Agent 接口接入自身批注监听。[Ryugi v1.103.3 授权](https://github.com/Innei/ryugi/blob/v1.103.3/LICENSE) · [DeepSeek Agent 接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md) · [验收 #154](https://github.com/yusixian/anjian/issues/154)

### v1.102.9 的能力差异

2026-11-23 核对 Ryugi 正式版 `v1.102.9`（`0e5f03594b723f4248b46bbf213c2fb75163c271`）。相对 `v1.102.8` 新增 2 个公开提交，累计审计 190 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.9) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.8...v1.102.9)

- `9f2422a` 修正带宿主前缀的自定义会话 ID，并隔离 Codex 绑定。案间把会话标识校验、Codex 环境变量隔离纳入 [#142](https://github.com/yusixian/anjian/issues/142) 的端到端验收。
- `0e5f035` 更新发布清单。该批新增代码不在 MIT 保留范围内，案间依据公开行为独立实现。[授权说明](https://github.com/Innei/ryugi/blob/v1.102.9/LICENSE)

### v1.102.8 的能力差异

2026-11-23 核对 Ryugi 正式版 `v1.102.8`（`71793405c405915492baea824ef842cb7e6130ae`）。相对 `v1.102.7` 新增 2 个公开提交，累计审计 188 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.8) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.7...v1.102.8)

- `8e976d3` 新增自定义宿主身份及命令投递。发布说明也列出从 Hub 通道移除单项订阅。案间已有内置宿主的本机 SSE 和项目或作品隔离，通用投递与即时取消订阅由 [#142](https://github.com/yusixian/anjian/issues/142) 独立实现。Copilot 的定向唤醒与回读原型见 [#136](https://github.com/yusixian/anjian/issues/136)。
- `7179340` 更新发布清单。该批新增代码不在 MIT 保留范围内。本次仅依据正式发布说明和公开文件清单记录任务。[授权说明](https://github.com/Innei/ryugi/blob/v1.102.8/LICENSE)

### v1.102.7 的能力差异

2026-11-23 核对 Ryugi 正式版 `v1.102.7`（`21e39ba0182c0589a109cab053b5b949044d8e86`）。相对 `v1.102.6` 新增 4 个公开提交，累计审计 186 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.7) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.6...v1.102.7)

- `600ba95` 更新官方云的设备码登录指引。案间沿用自己的设备授权和项目绑定流程。[设备授权](https://anjian.cosine.ren/zh/docs/remote-cli/)
- 公开的 daemon 工作流新增 Linux x64 和 arm64 制品。发布说明列出 systemd 用户服务、电源与进程状态及防休眠；公开树未包含实现。案间已有 Linux Hub 启停和容器部署，常驻服务及主机状态按 [#139](https://github.com/yusixian/anjian/issues/139) 独立实现。
- `fd5c166` 使 Ryugi README 字标跟随 GitHub 主题。案间 README 使用文本标题，文档站已有主题适配的品牌图。
- `21e39ba` 更新发布清单。该批新增上游内容不在 MIT 保留条款覆盖范围内。本次更新仅记录公开行为与独立实现事项。[授权说明](https://github.com/Innei/ryugi/blob/v1.102.7/LICENSE)

### v1.102.6 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.6`（`de9f13d4fd98bed85132d0bd5de76e2b82daa4c6`）。相对上一正式版 `v1.102.4` 新增 2 个公开提交，累计审计 182 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.6) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.4...v1.102.6)

- `8ad6bd6` 为启动器、钩子和监听器添加品牌进程名与版本。案间尚未设置这些标签。按 [#130](https://github.com/yusixian/anjian/issues/130) 独立实现并在 Linux 验证既有 Hub 启停与进程身份识别。该增量在上游 MIT 保留条款覆盖范围之外。[授权说明](https://github.com/Innei/ryugi/blob/v1.102.6/LICENSE)
- `de9f13d` 更新发布清单。

### v1.102.4 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.4`（`ab04426ef7ee5c9171f3c46f1eefa5002754133f`）。相对 `v1.102.3` 新增 1 个公开提交，累计审计 180 个提交。发布说明披露了按作品保留启动 Agent，可避免同项目的其他 Agent 改变提交按钮与默认回复署名。公开增量仅包含发布清单和启动引导。案间仍使用项目级标记，按 [#127](https://github.com/yusixian/anjian/issues/127) 独立实现。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.4) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.3...v1.102.4)

### v1.102.3 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.3`（`a9fe0fb1e953777458734160c2d3a8885ecc018a`）。相对 `v1.102.2` 新增 3 个公开提交，累计审计 179 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.3) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.2...v1.102.3)

- `385b86f` 将本地评论从宿主定时读取改为 Hub 推送。案间由 [#125](https://github.com/yusixian/anjian/issues/125) 独立实现事件订阅和重启恢复。Codex 已有基于 App Server 的唤醒路径，实际空闲会话纳入该项验收。普通 Antigravity 会话的外部投递继续由 [#52](https://github.com/yusixian/anjian/issues/52) 跟踪。
- `8c683fc` 为 macOS daemon 加上 Developer ID 签名与公证。案间双架构 CLI 安装包已有解压和安装测试，发布者验证与 Gatekeeper 验收由 [#124](https://github.com/yusixian/anjian/issues/124) 跟踪。发行说明中的 daemon 版本配套和 Claude 文件夹信任属于 Ryugi daemon 工作流。
- `a9fe0fb` 更新发布清单。上游两个功能提交新增的代码在该版本 MIT 保留条款覆盖范围之外，案间依据公开行为独立实现。[授权说明](https://github.com/Innei/ryugi/blob/v1.102.3/LICENSE)

### v1.102.2 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.2`（`3cc8871325f3f892858a482bc7dafd2665ff64f9`）。相对 `v1.102.1` 新增 1 个公开提交，累计审计 176 个提交。公开差异只更新版本清单。发布说明披露白板和幻灯片的长讨论可在卡片内滚动，打开时显示最新消息。案间按 [#100](https://github.com/yusixian/anjian/issues/100) 独立实现。桌面和 390 px Chrome 验证通过，已随 [v0.7.1](https://github.com/yusixian/anjian/releases/tag/v0.7.1) 发布。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.2) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.1...v1.102.2)

### v1.102.1 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.1`（`608491634da2f02cd9241364302b803268298f28`）。相对 `v1.102.0` 新增 3 个公开提交，累计审计 175 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.1) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.0...v1.102.1)

- 上游发布说明披露恢复或切换分支时保留人工批注。公开增量缺少 Viewer 实现。案间对正在运行的评论存储复现了恢复后丢弃新出现的人工批注，按 [#98](https://github.com/yusixian/anjian/issues/98) 独立实现并验证了五类作品的人工批注恢复，已随 [v0.7.2](https://github.com/yusixian/anjian/releases/tag/v0.7.2) 发布。
- `dd3c6d0` 改为只构建 Apple 芯片的 Ryugi daemon。案间自产安装包继续通过 Apple 芯片和 Intel 的构建、安装测试。[案间 v0.6.1](https://github.com/yusixian/anjian/releases/tag/v0.6.1)
- `d4dc16c` 将 Ryugi Cloud 的已交付变更纳入模型生成的发行说明。案间继续发布自己的双语 Changesets。`6084916` 更新公开清单版本。

### v1.102.0 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.0`（`c0d1b866a831f192bc035844c29e432f1a1b6529`）。相对 `v1.101.2` 新增 4 个提交，累计审计 172 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.0) · [增量差异](https://github.com/Innei/ryugi/compare/v1.101.2...v1.102.0)

- `46abf08`、`4efc47a` 调整验收报告的结论、证据、画板和规格工作单。案间已有输出摘要校验、可展开的原始日志及实时画板引用。跨环境展示、人工决定和规格记录保留按 [#95](https://github.com/yusixian/anjian/issues/95) 补齐并随 [v0.7.0](https://github.com/yusixian/anjian/releases/tag/v0.7.0) 发布。增量不在上游 MIT 保留范围内，案间根据公开行为独立实现，未引入上游代码或指导原文。[上游许可证](https://github.com/Innei/ryugi/blob/v1.102.0/LICENSE)
- `f07cbfd` 支持模型根据提交写发行说明，失败时使用固定模板。案间的发布说明由每批双语 Changeset 生成，作为案间发行的用户入口。[发版流程](docs/versioned-releases.md)
- `c0d1b86` 更新公开清单的版本号。

### v1.101.2 的变化

2026-11-22 核对 Ryugi 正式版 `v1.101.2`（`cda303f53fe96d1f2285d576469207b8aedbb717`）。相对 `v1.101.1` 新增一个提交，累计审计 168 个提交。12 个公开文件只更新版本号。用户和 Agent 的任务清单无需新增条目。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.101.2) · [增量差异](https://github.com/Innei/ryugi/compare/v1.101.1...v1.101.2)

### v1.101.1 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.101.1`（`e5ba9b62c1b1d576b7758d57d7e3be0567a54e18`）。新增四个提交，审计累计覆盖 167 个。案间使用[能力清单](docs/upstream-capabilities.md)维护等效证据、独立实现事项与下一轮审查起点。[增量差异](https://github.com/Innei/ryugi/compare/v1.99.1...v1.101.1)

| 增量                                                   | 处置                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `559487c` 为 Ryugi daemon 构建 macOS arm64 和 x64 制品 | 案间构建不依赖该 daemon。用户下载安装案间自产二进制的能力单独跟踪。[案间 #53](https://github.com/yusixian/anjian/issues/53)                                                                                                           |
| `6450c21` 生成 GitHub Release 说明                     | 案间已有中英 Changeset 自动生成发布说明。首批补丁已在临时副本生成 `0.4.1` 条目。[案间发版流程](docs/versioned-releases.md)                                                                                                            |
| `b45c50e` 与 `e5ba9b6` 刷新版本及生成文件              | 两次发布更新清单，前一次同时刷新评审与 CLI 输出生成文件。评审线程的导出重排未改变公开代码中的未读判定。输出助手涉及上游专有应用的协议，案间记录人工改动及评审摘要的行为差距。[案间 #50](https://github.com/yusixian/anjian/issues/50) |

## Ryugi v1.99.1 同步审计

2026-11-22 核对上游正式版 `v1.99.1`（`e647eb7e63a67310f1ac586bad369b13adabe2ed`），案间实施起点为 `0.4.0`（`04d711a59f24f63c51c7a3f08f9c943bd4ee6c4f`）。原始分叉基线为 `v1.51.2`。上游范围有 163 个提交，其中 43 个版本提交和 2 个合并提交随对应功能归档，其余 118 个按主要用途计数。[完整版本差异](https://github.com/Innei/ryugi/compare/v1.51.2...v1.99.1)

`d5192ca` 移出 `artifacts/` 的 CLI、服务端和界面源码。目标版本将后续 `ryugi-artifacts` 发行包标为专有。`d530dd6` 为 Skill、钩子、集成、脚本和文档引入 Ryugi License 1.0，Exhibit B 为指定 Superpowers 材料和部分 MIT 贡献保留授权。案间按具体文件及来源核对可移植范围。本轮重启断言依据基线后、源码迁出前的 AGPL 测试修正，其余钩子修复在案间实现中独立完成。[源码迁出记录](https://github.com/Innei/ryugi/commit/d5192ca) · [目标版本许可证](https://github.com/Innei/ryugi/blob/v1.99.1/LICENSE)

| 上游变化           | 提交数 | 案间处置                                                                                                                                           |
| ------------------ | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源码迁出与授权     |      4 | 依据上游发布声明保留案间独立源码及现有 MIT／AGPL-3.0-only 结构。                                                                                   |
| 反馈投递与生命周期 |     20 | 见下方逐行为处置。                                                                                                                                 |
| CLI 输出与作者工具 |     22 | 延期 Brief、JSONL、回执和模板生成协议。保留案间 CLI 的现有输出与消费者。                                                                           |
| 文档交互           |     10 | 延期内联问答、跨作品引用与级联分享、设计文档审批指针。未来分别验证旧文档读取、授权和撤销。                                                         |
| 作品类型           |      8 | 延期白板、幻灯片和故事板。公开仓库仅有相关 Skill、启动器或钩子变更。白板需要数据模型与元素批注，幻灯片需要分页与导出，故事板还需要多轨剪辑与渲染。 |
| 界面创作           |     12 | 延期界面创作、设计系统、业务模块标注和手机样机流程。                                                                                               |
| 通用工作流         |     15 | 延期工作树工作流、验证报告、Skill 拆分与 Agent 协作约定，分别评估案间集成。                                                                        |
| 安装与宿主集成     |     13 | 根据 `a7677a1` 的意图加强案间重启测试。跳过官方 npm 自动安装和品牌入口。Antigravity 等额外宿主单独评估。                                           |
| 发布基础设施       |      6 | 跳过依赖上游制品的发布流程。案间经双语 Changesets 独立发版。                                                                                       |
| 文档与品牌         |      8 | 跳过上游品牌、安装口径和产品文案，相关工作流说明随案间功能更新。                                                                                   |

### 反馈行为

- 案间已有项目、设备和会话绑定，网页明确提交后创建持久任务。0.4.0 已覆盖轮次提交重试、原子认领、撤权、旧代次隔离、重启恢复和用户验收。上游的 Pi 通知、TurnEnd 汇报和通知内嵌 Brief 延期，避免引入第二套任务调度、进度或读取标记。
- 本轮修复 Codex 本地监听合并待发送事件时误用画板作为选择轮次标识的问题。同一轮询里的不同轮次各自发送。同一轮次的既有状态转换规则保持适用。已连接 Lody 的画板继续通过持久任务处理轮次提交。
- 本轮给本地 Hub 项目注册请求设置五秒总时限，涵盖持续返回数据但未结束的响应。上游改动涉及不同的 Agent 事件端点，案间针对本地现有注册入口实现。
- 延期按仓库关系自动发现其他 worktree、跨项目订阅、线程读取回执和预览选中事件主动唤醒。案间远程反馈通过显式项目、作品、会话及设备授权连接，本地监听范围由实际项目和会话订阅确定。跨目录自动发现需要单独验证目标路由和授权边界。

<details>
<summary>提交分组索引（118 个非版本、非合并提交）</summary>

```text
源码迁出与授权：d5192ca e49dd6e c8e23b2 d530dd6
反馈投递与生命周期：4572619 20c216f e25a718 75f7134 0d41934 d2a3aa5 67b58be 06ae4a9 fa75b17 876fef2 55d1f00 6342e32 dbcbf9a d58f508 eec52b7 5450574 4f13ff8 9486224 646651a 3eb7823
CLI 输出与作者工具：e14f968 6b3b780 1e2a40b 431bea3 b9c9d8f 4418f2f 675b4e3 0c07ea7 5536039 38a0d7e 4b718f9 3a628e1 3d2b325 a222ba1 1d96bfa 74cf740 5a6b132 7020d2d 586f356 5c1cf60 92d935b dc98d60
文档交互：23ceec4 5b702ee 5e83e94 2189f35 aedd33d ed30790 8ace8fe 6f986c4 4f48a63 96a5d86
作品类型：7dc9ccc b9528c1 993c03f 37ecb1b 8c0f7ee 8ce93cd 42084c1 a7b5d34
界面创作：ff052de a7b2745 fd6748a 92a814b 05415a6 1445de4 c650c27 520e5bd 088018a 6d1d3db f79cc49 fcdd1e3
通用工作流：603e4cb 1b1be65 79d0dc8 61d479d 2525d98 7393ad3 4d11533 0f2591b e34ce62 bc75d0f 304e037 7f08ac0 aa9f450 baa5cf8 94d1f90
安装与宿主集成：a7677a1 9029f6f 984c689 d7580ec 0f71cbd 3685446 093d494 2360e62 f3bc951 dacf495 e5fbd8a 473cdc6 f56746c
发布基础设施：c4384df f8cf385 27b21bf 01f879d 17e565d 1da8821
文档与品牌：6605823 657d99a b95a8bd 6aaa254 fc618c2 0910813 2eb9fb6 1d89c4e
```

</details>

## Ryugi 的上游记录

Ryugi is a fork of [obra/superpowers](https://github.com/obra/superpowers) (MIT).

## Baseline

|                  |                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream release | **v7.0.0**                                                                                                                                                     |
| Upstream commit  | `bb92a77741419a4ab5f06e711a283343f1ada0c3`                                                                                                                     |
| Released         | 2026-10-10 (UTC)                                                                                                                                               |
| Last checked     | 2026-10-28 — upstream `main` is v7.0.1 (`2ce8aa15`); `dev` (`b58deb3b`) adds unreleased hook fixes. Baseline stays v7.0.0 until the remaining skill ports land |

Ryugi's git history was re-initialized and shares no commits with upstream, so
upstream changes can't be merged. Follow them by diffing upstream against the
baseline and porting through the path map below.

## Checking for upstream changes

```bash
git remote add upstream https://github.com/obra/superpowers.git # once per clone
git fetch upstream --tags

git log --oneline v7.0.0..upstream/main # released changes since the baseline
git diff --stat bb92a77 upstream/main   # what files they touched
git diff bb92a77 upstream/main -- skills/test-driven-development
git diff --stat bb92a77 upstream/dev # unreleased work: compare trees, not logs
```

Upstream releases land on `main` by rebase-merge, and `dev` keeps the original
commits, so `git log` against `dev` lists old work again. Use `git diff` for `dev`.

## Path map

| Upstream                                                                                                                          | Ryugi                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `superpowers` / `Superpowers` / `SUPERPOWERS`                                                                                     | `ryugi` / `Ryugi` / `RYUGI` (plugin name, `ryugi:` namespace, env vars)                  |
| `.superpowers/` (project working dir)                                                                                             | `.ryugi/`                                                                                |
| `skills/using-superpowers/`                                                                                                       | `skills/using-ryugi/` (adds Evidence Before Claims and the project-skills rule)          |
| `skills/executing-plans/`                                                                                                         | `skills/executing-specs/` (input is an approved spec; the executor writes `tasks.md`)    |
| `skills/subagent-driven-development/scripts/{sdd-workspace,task-brief,review-package}`                                            | `skills/executing-specs/scripts/`                                                        |
| `skills/requesting-code-review/code-reviewer.md`                                                                                  | `skills/executing-specs/code-reviewer.md`                                                |
| `skills/finishing-a-development-branch/` worktree cleanup                                                                         | `skills/using-git-worktrees/` Cleanup section                                            |
| `skills/verification-before-completion/`                                                                                          | Evidence Before Claims in `skills/using-ryugi/`                                          |
| `skills/brainstorming/` visual companion                                                                                          | `skills/artifacts/` (rewritten: local artboard + html artifacts, source in `artifacts/`) |
| `skills/writing-skills/`                                                                                                          | `.claude/skills/writing-skills/` (repo-local)                                            |
| `skills/writing-plans/`, `skills/dispatching-parallel-agents/`, `skills/diagnosing-superpowers/`, `skills/receiving-code-review/` | removed                                                                                  |
| `docs/superpowers/`, `docs/plans/`, `RELEASE-NOTES.md`                                                                            | removed (Ryugi specs live in `docs/ryugi/specs/`)                                        |

Closest to upstream, so the easiest to port: `skills/test-driven-development/` (apart from the
hand-off to `using-git-worktrees`),
`skills/systematic-debugging/` (apart from the hand-offs to `verifying-ui`), and the harness integrations (`hooks/`, `.codex-plugin/`,
`.opencode/`, `.pi/`, `.hermes-plugin/`, `.kimi-plugin/`, `.devin-plugin/`,
`.cursor-plugin/`, `.antigravity-plugin/`, `.muse-plugin/`, `gemini-extension.json`).

Rewritten around Ryugi's workflow, so port ideas rather than diffs:
`skills/brainstorming/` (handoff and Artboard sections), `skills/executing-specs/`,
`skills/using-git-worktrees/` (Where to work table; upstream's native-tool rule and
Cleanup survive), `skills/using-ryugi/`, `README.md`, `AGENTS.md`.

## Porting a change

1. Diff the upstream change against the baseline and map its paths with the table.
2. Apply it by hand, or with `git diff bb92a77 <upstream-ref> -- <path> > change.patch`, rewrite the paths, then `git apply change.patch`.
3. Rename `superpowers` to `ryugi` in whatever the patch adds.
4. Run the tests for what it touched; skill-content changes also need the before/after eval from `writing-skills`.
5. Record the sync below and move the baseline forward when everything up to an upstream release has been ported or deliberately skipped.

## Sync log

| Date       | Upstream ref                            | Ported                                                                                                                                                                                                                                                                                                                    | Skipped                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-19 | v7.0.0 (`bb92a77`)                      | Fork baseline                                                                                                                                                                                                                                                                                                             | —                                                                                                                                                                                                                                                          |
| 2026-10-28 | v7.0.1 (`2ce8aa15`), `dev` (`b58deb3b`) | Infra only: PR/issue templates + `AGENTS.md` human-summary and issue-ownership rules; `hooks.json` `powershell` key (all three hooks); `run-hook.cmd` no-subshell Unix half + `zsh`/quiet-exit fallback; `.muse-plugin` hook runs `bash`; Pi drops `resources_discover` in favour of `pi.skills`; docs and tests for each | v7.0.1 skill changes (brainstorming retune, references splits, `executing-plans` trim); `tests/skill-size`; `hooks/session-start` zero-fork rewrite (conflicts with Ryugi's artifacts-server block); upstream version bumps (Ryugi versions independently) |
