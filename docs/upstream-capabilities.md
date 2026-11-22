# 案间与 Ryugi 能力对照

2026-11-22 核对案间 `0.4.0`（`04d711a`）与 Ryugi 正式版 `v1.101.1`（`e5ba9b6`）。首批同步修复已在案间候选分支本地验收。[上游发行版](https://github.com/Innei/ryugi/releases/tag/v1.101.1) · [案间总追踪 #55](https://github.com/yusixian/anjian/issues/55) · [提交及授权记录](../UPSTREAM.md)

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

## 待交付能力

| 能力                                                 | 当前进度或依赖                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同批选择轮次分别通知，Hub 被拖长的注册请求按时结束   | 首批候选已本地验收。[#40](https://github.com/yusixian/anjian/issues/40)                                                                                                                                         |
| 另一 worktree 的显式反馈订阅                         | 独立候选已本地验证，待发布。两个真实 worktree 的同名文档和同名选择轮次分别送到指定会话。使用真实 CLI 与 Hub，Codex 队列传输为测试替身。[#41](https://github.com/yusixian/anjian/issues/41)                      |
| 查看每个会话的批注阅读状态，主动将预览选区发给 Agent | 两项分别跟踪，可复用已有游标和临时选区。[#42](https://github.com/yusixian/anjian/issues/42) · [#43](https://github.com/yusixian/anjian/issues/43)                                                               |
| 文档内提问并收集提交后的答案                         | 独立候选已验证选择题、开放题、草稿恢复、撤回及实际 Lody 回复和验收。题目保存在正文，回答进入既有持久反馈任务。[#44](https://github.com/yusixian/anjian/issues/44)                                               |
| 从文档准确定位作品并附评审状态                       | 用既有作品身份、权限与快照语义。[#45](https://github.com/yusixian/anjian/issues/45)                                                                                                                             |
| 用报告汇总机器检查、人工验收和未验证事项             | 可先复用画板验收，作品引用可用后加入目标状态。[#46](https://github.com/yusixian/anjian/issues/46)                                                                                                               |
| 独立白板、幻灯片与演讲者视图、产品分镜与视频导出     | 分别实现和验收，白板可评估复用嵌入式绘图的依赖。[#47](https://github.com/yusixian/anjian/issues/47) · [#48](https://github.com/yusixian/anjian/issues/48) · [#49](https://github.com/yusixian/anjian/issues/49) |
| 从 CLI 读取人工改动和评审证据                        | 从现有文档历史及 CLI 输出契约扩展。[#50](https://github.com/yusixian/anjian/issues/50)                                                                                                                          |
| 维护可复用的设计约定，实施时固定到人工批准的修订     | 设计规范可独立推进，设计批准依赖文档问答。[#51](https://github.com/yusixian/anjian/issues/51) · [#54](https://github.com/yusixian/anjian/issues/54)                                                             |
| 更多本地宿主接入与 macOS 双架构制品                  | 分批验证实际宿主和平台。[#52](https://github.com/yusixian/anjian/issues/52) · [#53](https://github.com/yusixian/anjian/issues/53)                                                                               |

## 后续同步

查询 Ryugi 最新正式发行版并固定 tag 和提交。只审查上次记录之后的增量，结合公开文档核对行为。将相同任务映射到已有证据或 Issue。每次在来源记录写明新增范围及授权判断，更新对应能力的验收或 Issue，避免重复开单。案间独有的中文默认、本地存储、成员权限、自托管、公开只读分享和 Lody 闭环进入相关改动的回归范围。每批用户可见改动通过中英 Changeset 进入案间的发布说明。

应用源码在上游分叉后迁出。案间保留 MIT 与 AGPL-3.0-only 授权结构，并单独核对拟移植材料。官方云、订阅和自动下载官方包属于上游产品边界。[上游授权说明](https://github.com/Innei/ryugi/blob/v1.101.1/LICENSE)
