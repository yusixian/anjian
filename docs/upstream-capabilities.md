# 案间与 Ryugi 能力对照

2026-11-22 核对 Ryugi 正式版 `v1.102.2`（`3cc8871`）。案间以 `0.4.0`（`04d711a`）为实施起点。首批同步及两个后续能力已发布至 `0.5.0`（`26d574a`），本地画板摘要和文档问答随后发布至 `0.6.0`（`80c64d6`）。[案间 0.5.0 发布说明与安装包](https://github.com/yusixian/anjian/releases/tag/v0.5.0) · [上游发行版](https://github.com/Innei/ryugi/releases/tag/v1.102.2) · [案间总追踪 #55](https://github.com/yusixian/anjian/issues/55) · [提交及授权记录](../UPSTREAM.md)

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

## 新版差距

- [#100](https://github.com/yusixian/anjian/issues/100) 跟踪白板和幻灯片长批注的最新消息及卡片内滚动。
- [#98](https://github.com/yusixian/anjian/issues/98) 跟踪运行中恢复评论文件时保留已有人工批注。
- [#52](https://github.com/yusixian/anjian/issues/52) 跟踪向已经运行的普通 Antigravity 交互会话投递反馈。

## 后续同步

查询 Ryugi 最新正式发行版并固定 tag 和提交。只审查上次记录之后的增量，结合公开文档核对行为。将相同任务映射到已有证据或 Issue。每次在来源记录写明新增范围及授权判断，更新对应能力的验收或 Issue，避免重复开单。案间独有的中文默认、本地存储、成员权限、自托管、公开只读分享和 Lody 闭环进入相关改动的回归范围。每批用户可见改动通过中英 Changeset 进入案间的发布说明。

应用源码在上游分叉后迁出。案间保留 MIT 与 AGPL-3.0-only 授权结构，并单独核对拟移植材料。官方云、订阅和自动下载官方包属于上游产品边界。[上游授权说明](https://github.com/Innei/ryugi/blob/v1.101.1/LICENSE)
