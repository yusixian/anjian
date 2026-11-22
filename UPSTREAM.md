# 来源记录

本项目从 Innei/ryugi 的 `v1.51.2` 分叉，基线提交为 `6054b65ab9b2208a234a78632eb065cfeb3eb166`。案间以个人使用、本地运行和中文体验为主，独立发布并持续核对上游正式版本的能力。引入后续上游代码前，须单独核对其许可证和适用性。

以下保留 Ryugi 原有的 Superpowers 来源与迁移记录，供追溯使用；其中的远程名、发布基线和同步步骤并非本项目的更新策略。

## 当前对照版本

2026-11-22 核对 Ryugi 正式版 `v1.102.2`（`3cc8871325f3f892858a482bc7dafd2665ff64f9`）。相对 `v1.102.1` 新增 1 个公开提交，累计审计 176 个提交。公开差异只更新版本清单。发布说明披露白板和幻灯片的长讨论可在卡片内滚动，打开时显示最新消息。案间已在桌面和 390 px Chrome 复现长讨论超出视口，按 [#100](https://github.com/yusixian/anjian/issues/100) 独立实现。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.2) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.1...v1.102.2)

### v1.102.1 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.1`（`608491634da2f02cd9241364302b803268298f28`）。相对 `v1.102.0` 新增 3 个公开提交，累计审计 175 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.1) · [增量差异](https://github.com/Innei/ryugi/compare/v1.102.0...v1.102.1)

- 上游发布说明披露恢复或切换分支时保留人工批注。公开增量缺少 Viewer 实现。案间对正在运行的评论存储复现了恢复后丢弃新出现的人工批注，已登记 [#98](https://github.com/yusixian/anjian/issues/98)，需要独立实现可信恢复。
- `dd3c6d0` 改为只构建 Apple 芯片的 Ryugi daemon。案间自产安装包继续通过 Apple 芯片和 Intel 的构建、安装测试。[案间 v0.6.1](https://github.com/yusixian/anjian/releases/tag/v0.6.1)
- `d4dc16c` 将 Ryugi Cloud 的已交付变更纳入模型生成的发行说明。案间继续发布自己的双语 Changesets。`6084916` 更新公开清单版本。

### v1.102.0 的能力差异

2026-11-22 核对 Ryugi 正式版 `v1.102.0`（`c0d1b866a831f192bc035844c29e432f1a1b6529`）。相对 `v1.101.2` 新增 4 个提交，累计审计 172 个提交。[正式发布](https://github.com/Innei/ryugi/releases/tag/v1.102.0) · [增量差异](https://github.com/Innei/ryugi/compare/v1.101.2...v1.102.0)

- `46abf08`、`4efc47a` 调整验收报告的结论、证据、画板和规格工作单。案间已有输出摘要校验、可展开的原始日志及实时画板引用。跨环境展示、人工决定和规格记录保留由 [#95](https://github.com/yusixian/anjian/issues/95) 跟踪。增量不在上游 MIT 保留范围内，案间根据公开行为独立实现，未引入上游代码或指导原文。[上游许可证](https://github.com/Innei/ryugi/blob/v1.102.0/LICENSE)
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
