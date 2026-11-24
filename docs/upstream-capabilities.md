# 案间与 Ryugi 能力对照

2026-11-24 核对 Ryugi 正式版 `v1.108.7`（`3bdef4c`）。案间以 `0.4.0`（`04d711a`）为实施起点。下表区分正式版与已合入的能力。[案间正式版](https://github.com/yusixian/anjian/releases) · [Ryugi 正式版](https://github.com/Innei/ryugi/releases/tag/v1.108.7) · [总追踪 #55](https://github.com/yusixian/anjian/issues/55) · [提交及授权记录](../UPSTREAM.md)

## 已有能力与证据

| 用户或 Agent 的任务                                        | 案间现有入口和证据                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用本机源码预览文档、画板和 HTML，读取内置 CLI 指南         | [启动、停止、重启集成测试](../artifacts/test/cli-start-stop.test.ts) · [内置 Skill 指南](../skills/artifacts/SKILL.md)                                                                                |
| 从自建 Hub 拉取作品、修改并上传，同时保护网页端的新改动    | [远程 API 和冲突保护测试](../artifacts/test/remote-api.test.ts) · [远程传输测试](../artifacts/test/remote-transfer.test.ts)                                                                           |
| 联机编辑文档、回看历史、按段落批注                         | [文档历史](../artifacts/test/document-history.test.ts) · [块批注](../artifacts/test/block-comments.test.tsx)                                                                                          |
| 在画板里选方案并提交，按证据验收                           | [画板问题](../artifacts/test/artboard-questions.test.ts) · [验收与证据变化](../artifacts/test/verdicts.test.ts)                                                                                       |
| 把批注或选择轮次交给指定 Agent，回读修订和回复，再人工验收 | [真实 Hub 和 CLI 测试](../artifacts/test/feedback-api.test.ts) · [真实 Lody 和浏览器证据](DELIVERY_GOAL.md#ryugi-v1991-同步验收2026-11-22) · [案间 #37](https://github.com/yusixian/anjian/issues/37) |
| 公开分享一个只读作品并撤销访问                             | [公开分享测试](../artifacts/test/public-share.test.ts)                                                                                                                                                |
| 通过案间发布记录查看中英文更新说明                         | [双语 Changesets](versioned-releases.md) · [已生成版本说明](../CHANGELOG.md)                                                                                                                          |

## v0.5.0 已交付能力

| 用户或 Agent 的任务                                               | 入口和验证证据                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 让同批画板轮次分别通知，结束迟迟未完成的 Hub 注册请求             | [同步修复与验证 #56](https://github.com/yusixian/anjian/pull/56)                                                                                                                                            |
| 在另一工作区订阅反馈，分会话确认已读，从 HTML 发送选区            | [跨工作区验证 #57](https://github.com/yusixian/anjian/pull/57) · [会话回执集成测试](../artifacts/test/comment-receipts.test.ts) · [组合浏览器验证 #81](https://github.com/yusixian/anjian/pull/81)          |
| 在文档提问、记录回答，或批准精确的设计修订                        | [文档评审组合验收 #79](https://github.com/yusixian/anjian/pull/79) · [CLI 批准入口](artifacts-cli.md#确认设计批准)                                                                                          |
| 在文档中引用作品，追踪人工改动、评审状态和验收证据                | [作品定位集成测试](../artifacts/test/artifact-reference-api.test.ts) · [CLI 查询](artifacts-cli.md#查看人工改动与评审)                                                                                      |
| 用可复用的设计规范生成可追溯的验收报告                            | [规范集成测试](../artifacts/test/design-spec.test.ts) · [实际浏览器与报告验证](ryugi/skill-evals/2026-11-22-anjian-design-specifications.md)                                                                |
| 编辑独立白板，按页、画框及元素定位                                | [白板多页验证 #72](https://github.com/yusixian/anjian/pull/72) · [画框集成测试](../artifacts/test/whiteboard-frames.test.ts)                                                                                |
| 编辑幻灯片，使用同步演讲者窗口并按页批注                          | [双窗口、键盘和手机验收 #73](https://github.com/yusixian/anjian/pull/73)                                                                                                                                    |
| 剪多轨分镜，按片段批注并导出 MP4                                  | [分镜浏览器与 CLI 验证 #75](https://github.com/yusixian/anjian/pull/75) · [FFmpeg 渲染测试](../artifacts/test/storyboard-render.test.ts) · [Linux 容器实测 #81](https://github.com/yusixian/anjian/pull/81) |
| 把白板、幻灯片和分镜的批注提交给已连接的 Lody 会话                | [三类作品评审集成 #77](https://github.com/yusixian/anjian/pull/77) · [真实 Lody 白板回传与验收 #81](https://github.com/yusixian/anjian/pull/81)                                                             |
| 在 Pi 或 Antigravity 接收本地批注，在 Apple 芯片或 Intel 安装 CLI | [宿主实际验证 #80](https://github.com/yusixian/anjian/pull/80) · [正式发布打包流水线](https://github.com/yusixian/anjian/actions/runs/44991156677)                                                          |
| 让 Agent 在同一画板里比较多套手机样机                             | [启动和 390 px 浏览器验证 #84](https://github.com/yusixian/anjian/pull/84)                                                                                                                                  |
| 匿名分享文档和明确选中的同项目引用快照                            | [发布、匿名访问和撤销验证 #85](https://github.com/yusixian/anjian/pull/85) · [公开分享指南](https://anjian.cosine.ren/zh/docs/sharing/)                                                                     |

实际操作入口见[线上新功能上手指南](https://anjian.cosine.ren/zh/docs/review-workflows/)。上表中的浏览器与 Agent 流程证据来自隔离环境，公开指南及更新说明已经在线验收。

## v0.6.0 本地反馈

[案间 #86](https://github.com/yusixian/anjian/issues/86) 跟踪本地 Agent 唤醒中的提交摘要。画板部分见 [#90](https://github.com/yusixian/anjian/pull/90)，本地问答在同一文档存在多个会话时可选择接收者，支持 Codex、Pi 和 Antigravity，并沿用同一题的提交与撤回规则。Chrome 实测桌面撤回、390 px 重载保留草稿及 Pi 双会话隔离。长答案回退见 [#93](https://github.com/yusixian/anjian/pull/93)。入口见[中英文 Agent 指南](../website/content/docs/agent.mdx)。

## v0.7.0 验收报告

打开评审文档查看常规检查摘要、待人工决定的事项和画板验收汇总。展开记录可查看原始证据，点击画板汇总可跳回作品。规格工作单保留至完成验收或合入分支。[上手指南](https://anjian.cosine.ren/zh/docs/review-workflows/) · [验收证据 #95](https://github.com/yusixian/anjian/issues/95) · [v0.7.0](https://github.com/yusixian/anjian/releases/tag/v0.7.0)

## v0.7.1 至 v0.7.3 评审和预览修复

| 用户或 Agent 的任务                                        | 案间入口和验证证据                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 从最新消息开始阅读白板或幻灯片的长讨论，向上查看历史       | 白板「评论」和幻灯片「本页批注」的卡片可以独立滚动。桌面及 390 px Chrome 核对初始位置、键盘和刷新。[验收 PR #101](https://github.com/yusixian/anjian/pull/101) · [v0.7.1 更新说明](https://anjian.cosine.ren/zh/docs/updates/#071)                                                                                                         |
| 在 Hub 运行时切换或合并 Git 分支，核对并恢复带入的人工批注 | 在原文档、画板、白板、幻灯片或分镜点「恢复批注」，预览并确认合并，也可导入原作品的备份。五类作品的隔离 Hub、Git、CLI 和 Chrome 验收见 [PR #103](https://github.com/yusixian/anjian/pull/103)。[上手指南](https://anjian.cosine.ren/zh/docs/review-workflows/#恢复批注) · [v0.7.2 更新说明](https://anjian.cosine.ren/zh/docs/updates/#072) |
| 在 HTML 预览中查看页面启动时上报的运行错误                 | 保留首次文件监听事件前上报的运行警告。编辑源文件后清除旧警告。[Hub 回归 PR #106](https://github.com/yusixian/anjian/pull/106) · [v0.7.3 主分支检查](https://github.com/yusixian/anjian/actions/runs/45011465868) · [v0.7.3 更新说明](https://anjian.cosine.ren/zh/docs/updates/#073)                                                       |

## v0.7.4 至 v0.9.0 画板评审

| 用户或 Agent 的任务                                     | 案间入口和验证证据                                                                                                                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 从文档查看画板选择组已提交的方案                        | 选择组引用卡片显示提交结果，撤回后清除，可跳回原选择组。[Hub 与 Chrome 验收 #111](https://github.com/yusixian/anjian/pull/111) · [v0.7.4 更新说明](https://anjian.cosine.ren/zh/docs/updates/#074)                      |
| 在同一画板用动作或条件串起多个界面                      | Agent 可用 `canvas.json` 的 `connections` 连接卡片。Chrome 核对跨页隔离、移动、平移和缩放。[验收 #115](https://github.com/yusixian/anjian/pull/115) · [v0.8.0 更新说明](https://anjian.cosine.ren/zh/docs/updates/#080) |
| 在浏览器移动画板卡片、标题和便签，继续让 Agent 更新作品 | 「调整布局」支持拖动和键盘微调。隔离 Hub 核对并发冲突、上传与重启，Chrome 核对桌面和触摸。[验收 #119](https://github.com/yusixian/anjian/pull/119) · [v0.9.0 更新说明](https://anjian.cosine.ren/zh/docs/updates/#090)  |

## v0.10.0 画板对象选择

画板上的「选择画布对象」支持标记画板卡片、标题和便签，Agent 在下一次提示中读取对象类型、页面和标识。桌面和 320、390 px Chrome 验证选择与清除，真实 Hub 和提示词 Hook 核对切页与删除后的状态。[功能验收 #122](https://github.com/yusixian/anjian/pull/122) · [中文说明](https://anjian.cosine.ren/zh/docs/updates/#0100) · [English notes](https://anjian.cosine.ren/en/docs/updates/#0100)

## v0.11.0 本机评论推送

已订阅作品的本机宿主接收 Hub 推送的变更通知。四种宿主的回归覆盖订阅、轮次和回执。真实 Codex App Server 配本地模型桩验证空闲线程接收评论、未订阅线程保持空闲、Hub 异常退出后恢复和手动停止。[功能验收 #128](https://github.com/yusixian/anjian/pull/128) · [中文说明](https://anjian.cosine.ren/zh/docs/updates/#0110) · [English notes](https://anjian.cosine.ren/en/docs/updates/#0110)

## v0.11.1 作品级 Agent 署名

启动 Agent 和默认回复作者按作品记录。桌面与 320、390 px Chrome 验证中英文提交按钮与活动宿主对应，实际 CLI 回归覆盖旧作品和显式署名。[验收 #131](https://github.com/yusixian/anjian/pull/131) · [中文说明](https://anjian.cosine.ren/zh/docs/updates/#0111) · [English notes](https://anjian.cosine.ren/en/docs/updates/#0111)

## v0.11.2 进程识别

macOS 活动监视器实测显示案间 Hub 和反馈监听器的名字、版本。Linux 保留 Hub 的实例参数，Node 22 容器验证启动、复用、异常恢复和手动停止。[验收 #133](https://github.com/yusixian/anjian/pull/133) · [中文说明](https://anjian.cosine.ren/zh/docs/updates/#0112) · [English notes](https://anjian.cosine.ren/en/docs/updates/#0112)

## GitHub Copilot CLI 作品批注

Ryugi 官网列出 Copilot CLI 兼容。案间以官方 Copilot CLI 1.0.114 和本地 OpenAI 兼容模型替身验收了项目级 Skill 加载、创建案间文档与 CLI 校验、Chrome 提交批注及原会话恢复后主动回读。自动投递另作验证。[案间 #136](https://github.com/yusixian/anjian/issues/136) · [中文上手](../website/content/docs/agent.mdx#github-copilot-cli) · [English guide](../website/content/docs/agent.en.mdx#github-copilot-cli)

## v0.12.1 自定义宿主退订与 v0.13.0 Linux 用户服务

本机 Hub 按每条连接订阅的作品发送通知。真实事件流验证单项退订、同名项目隔离、连接恢复和新旧客户端兼容。真实 Ubuntu x64 systemd 用户管理器验证登录目标启动、崩溃恢复、拒绝接管和卸载保留数据。Linux arm64 容器验证生成单元的语法和拒绝接管。[宿主验收 #146](https://github.com/yusixian/anjian/pull/146) · [Linux 验收 #148](https://github.com/yusixian/anjian/pull/148) · [中文更新](https://anjian.cosine.ren/zh/docs/updates/#0130) · [English notes](https://anjian.cosine.ren/en/docs/updates/#0130)

## v0.14.0 至 v0.18.0 评审、安装与反馈

| 用户或 Agent 的任务                                                | 案间入口和验证证据                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 在案间查看或删除画板预览，并把位置交给 Agent                       | 桌面和窄屏验收已发布的预览、撤回和定位回传。[验收 #156](https://github.com/yusixian/anjian/pull/156) · [中文](https://anjian.cosine.ren/zh/docs/updates/#0140) · [English](https://anjian.cosine.ren/en/docs/updates/#0140)                                                        |
| 在没有系统 Node 的 Linux 安装案间，并在登录后维持 Hub              | Ubuntu x64 与原生 arm64 分别验证独立包、HTML 预览、systemd 用户服务启动、崩溃后重启和卸载。[正式版验收 #139](https://github.com/yusixian/anjian/issues/139) · [中文](https://anjian.cosine.ren/zh/docs/updates/#0150) · [English](https://anjian.cosine.ren/en/docs/updates/#0150) |
| 从 ChatGPT 桌面应用的 Codex 接收定向作品批注，并判断钩子是否已授权 | 两个真实桌面会话接收各自同名文档的 Chrome 批注。用 v0.17.0 macOS arm64 发布包验证 `anjian doctor codex --json` 的五种状态与配置只读性。[桌面验收 #150](https://github.com/yusixian/anjian/issues/150) · [中英文指南](../website/content/docs/review-workflows.mdx)                 |
| 在本机报告页重跑登记过的检查并保留原始证据                         | Chrome 1280 和 390 像素视口验收通过与失败结果，原有证据保持可查看。运行依赖本机 Hub 的显式登记并单独保存历史。[合入与验证 #175](https://github.com/yusixian/anjian/pull/175)                                                                                                       |

## 自托管 HTTPS 浏览器验收

在隔离 Hub 上分别使用 1280 像素桌面和 390 像素触摸视口。两个独立 Chrome 会话交替编辑并回读幻灯片和分镜标题，验证白板页面新增与验收报告正文保存。匿名会话能阅读已分享的幻灯片快照，私有幻灯片的读写请求均返回 403。[步骤与待验项 #177](https://github.com/yusixian/anjian/issues/177)

通过合成 OAuth 服务走实际邀请和登录。受邀成员在自己的项目里编辑四类私有作品，另一成员的读写被拒绝，暂停成员后原会话立即失效。并发编辑报告时两处改动合并并持久化，白板会提示版本冲突并保护已保存内容。正式 v0.18.0 macOS arm64 安装包能读取新版生成的 JSON 报告。[完整验收 #177](https://github.com/yusixian/anjian/issues/177)

正式 v0.18.0 和 v0.18.2 的 macOS arm64 包双向验证了 CLI 与 Hub 的配对、绑定、文档拉取和上传，以及批注写入和读取。另用 Chrome 保留旧版文档页，往返切换 Hub 版本。页面重新连接后可继续编辑，窄屏新页面可读回。[CLI 验收 #165](https://github.com/yusixian/anjian/issues/165#issuecomment-7114715292) · [浏览器验收 #177](https://github.com/yusixian/anjian/issues/177#issuecomment-7114786138)

## 作品库与 JSON 证据

- 作品库保持打开时，两项目各连续创建八份作品，桌面与 390 像素触摸视口每批各刷新一次。空闲 20.5 秒无列表请求，断线时仍能回退刷新。[实现 #183](https://github.com/yusixian/anjian/pull/183) · [测量 #180](https://github.com/yusixian/anjian/issues/180)
- 在验收报告里展开「原始输出」，可阅读通过摘要校验的完整 JSON，先用数据表预览筛查内容。桌面和 390 像素触摸视口均验收表格、语法高亮和原文。[实现 #184](https://github.com/yusixian/anjian/pull/184) · [中英文指南](../website/content/docs/review-workflows.mdx)

## 画板预览编辑与报告重跑

- 检查器删除只影响当前预览。真实 Claude Code 可在下一轮读到原始文件和元素路径。按钩子给出的路径修改原稿后，两个 Chrome 会话均看到保存结果，相邻元素仍在。[Claude Code 验收 #156](https://github.com/yusixian/anjian/pull/156) · [源文件验收 #153](https://github.com/yusixian/anjian/issues/153#issuecomment-7115510035)
- 同一画板里的卡片和便签可由两个会话同时调整，双方实时看到更新。同一对象的较晚保存若基于旧坐标，会显示冲突并采用已保存的位置。三种工具都可从预览内用鼠标中键拖动平移。[Chrome 验收 #153](https://github.com/yusixian/anjian/issues/153#issuecomment-7115385124) · [中文指南](https://anjian.cosine.ren/zh/docs/artboards/) · [English guide](https://anjian.cosine.ren/en/docs/artboards/)
- v0.18.3 支持自托管站点所有者重跑显式登记的检查，也能用「刷新报告」同步正文、引用和运行历史并保留草稿。桌面和触摸视口已实测。旧 Hub 拒绝重跑时，新面板给出核对配置和升级的提示。恢复报告配置后可刷新面板继续运行。[报告验收 #152](https://github.com/yusixian/anjian/issues/152) · [兼容提示 #191](https://github.com/yusixian/anjian/pull/191) · [中文指南](https://anjian.cosine.ren/zh/docs/documents/) · [English guide](https://anjian.cosine.ren/en/docs/documents/)

## Codex、Pi 与 DeepSeek 的定向反馈

- 项目内有多个会话时，Codex 批注和 HTML 选区按作品投递，Pi 监听状态按作品显示。真实 DeepSeek Web 的两个会话也能用 `/anjian watch` 分别订阅同一项目内的不同文档。[Codex 与 Pi 回归](https://github.com/yusixian/anjian/issues/55#issuecomment-7125296895) · [DeepSeek 双会话验收](https://github.com/yusixian/anjian/issues/55#issuecomment-7125506843)
- 已接入 Codex App Server 的会话请求修改文件时，可在作品页查看补丁并决定一次允许、拒绝改动或取消本轮。桌面和窄屏 Chrome 已验证审批、取消与同名项目隔离。[浏览器验收 #209](https://github.com/yusixian/anjian/pull/209) · [中文用法](https://anjian.cosine.ren/zh/docs/updates/#01811) · [English guide](https://anjian.cosine.ren/en/docs/updates/#01811)

## 选案轮次的即时反馈

开放轮次内的板块或分组批注会即时通知已订阅作品的本地会话。选项点按保持安静，明确提交发送一条专用选案摘要。批注与提交若在同一次扫描内到达，Agent 可从提交通知读取该轮批注。[Hook 回归](../tests/hooks/test-comment-watch.cjs)

## 文档块引用

在 `<ref type="document">` 中填写 `block`，按目标文档和顶层块的稳定标识跳转。同文档引用支持浏览器返回。跨文档时桌面用只读侧栏，窄屏用完整文档。目标块缺失时，案间提示并打开有权查看的文档。公开分享仍需明确选择另行公开的目标快照。[实现与验收 #213](https://github.com/yusixian/anjian/issues/213) · [编写示例](../skills/artifacts/document.md)

## 分镜播放与旁白

分镜导出时，视频片段超出素材的部分保留最后一帧，原音轨自然结束。700 毫秒素材的 1.5 秒成片在桌面和窄屏 Chrome 均验证了末帧。[渲染回归](../artifacts/test/storyboard-render.test.ts) · [分镜用法](../skills/artifacts/storyboard.md)

在监看器聚焦后，空格控制播放，左右键每次定位五秒。v0.18.17 监看器显示播放位置和总时长，视频缓冲时停在最近显示的帧。鼠标点击画面自动聚焦的修复已合入。导入 WAV 旁白并导出带语音的 MP4 已用正式包验证。[时钟验收 #228](https://github.com/yusixian/anjian/pull/228#issuecomment-7141459010) · [鼠标焦点 #230](https://github.com/yusixian/anjian/pull/230) · [旁白实测](https://github.com/yusixian/anjian/issues/214#issuecomment-7141384095) · [中文](https://anjian.cosine.ren/zh/docs/updates/#01817) · [English](https://anjian.cosine.ren/en/docs/updates/#01817)

## 画板缩放、标题和快照

缩放基准先确认真实板块内容已加载。v0.18.16 的 `anjian check` 会提示标题压到独立板块，移开标题后提示消失。正式包的桌面和窄屏 Chrome 均验证了长标题的换行以及缩远后的 24 px 字号下限。极低缩放时，字号下限可能让原本分开的标题压到板块。同次打开可捕获远景并卸载 iframe，重开会重新加载。[缩放基准 #225](https://github.com/yusixian/anjian/pull/225) · [标题与快照 #219](https://github.com/yusixian/anjian/issues/219#issuecomment-7141341701) · [低倍率标题复现](https://github.com/yusixian/anjian/issues/219#issuecomment-7141829371)

## 待验证能力

- [#219](https://github.com/yusixian/anjian/issues/219) 画板远景标题避让、缩放流畅度与跨次打开的快照复用。
- [#214](https://github.com/yusixian/anjian/issues/214) 分镜旁白生成、逐行发音提示和词表，以及触屏监看器交互。
- [#231](https://github.com/yusixian/anjian/issues/231) 手机样机的开关、分段选择器和滑块。
- [#232](https://github.com/yusixian/anjian/issues/232) 作品库文档缩略图的体积与可读性。
- [#177](https://github.com/yusixian/anjian/issues/177) 自托管私有作品的实体第二台设备验收，以及其他作品类型的协议不兼容提示和只读路径。
- [#166](https://github.com/yusixian/anjian/issues/166) Antigravity 原生桌面作品侧栏。官方 CLI 已校验隔离插件声明，模拟宿主测试已覆盖侧栏空态、作品切换和会话隔离。原生宿主、真实 Hub 和实时批注仍待验收。
- [#151](https://github.com/yusixian/anjian/issues/151) 浏览器任务入口与运行中的本地会话交互，继续验证直接从 ChatGPT 桌面应用打开的 Codex 会话。
- [#165](https://github.com/yusixian/anjian/issues/165) 其余宿主的离线安装和跨版本协议。未订阅作品的 DeepSeek 会话是否需要项目级提醒，见 [#55](https://github.com/yusixian/anjian/issues/55#issuecomment-7125506843)。
- Linux 主机电源、进程和临时防休眠。v0.18.1 已修复启动期间停止 systemd 用户服务会误报失败的问题。[#139](https://github.com/yusixian/anjian/issues/139)

- macOS 双架构 CLI 发布包的 Developer ID 签名与公证。现有包已通过解压安装、启动测试与 SHA-256 校验。[签名与公证 #124](https://github.com/yusixian/anjian/issues/124)

- 把反馈自动投递给已经运行的普通 Antigravity 交互会话。已验证由案间启动的流式会话接收反馈、普通会话主动读取批注，以及 Pi 会话的投递和回执。普通 Antigravity 会话的外部投递仍待找到公开接口并完成两路会话隔离验证。[宿主证据和缺口 #52](https://github.com/yusixian/anjian/issues/52)

## 后续同步

[Check Ryugi release](https://github.com/yusixian/anjian/actions/workflows/check-ryugi-release.yml) 每天核对 GitHub 的最新正式版与 `UPSTREAM.md` 的已审计版本，也可手动运行。版本有变化时，从运行摘要打开差异。

查询 Ryugi 最新正式发行版并固定 tag 和提交。只审查上次记录之后的增量，结合公开文档核对行为。将相同任务映射到已有证据或 Issue。每次在来源记录写明新增范围及授权判断，更新对应能力的验收或 Issue，避免重复开单。案间独有的中文默认、本地存储、成员权限、自托管、公开只读分享和 Lody 闭环进入相关改动的回归范围。每批用户可见改动通过中英 Changeset 进入案间的发布说明。

应用源码在上游分叉后迁出。案间保留 MIT 与 AGPL-3.0-only 授权结构，并单独核对拟移植材料。官方云、订阅和自动下载官方包属于上游产品边界。[上游授权说明](https://github.com/Innei/ryugi/blob/v1.101.1/LICENSE)
