# anjian-workflow

## 0.10.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

画板新增「选择画布对象」。可选中一个或多个卡片、标题或便签，Agent 能按页面、类型和稳定 ID 读取选区。

<!-- anjian:en -->

#### English

Use **Select canvas objects** to mark boards, titles, or sticky notes. The Agent can read their page, object type, and stable ID.

<!-- anjian:end -->

## 0.9.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

从画板工具栏打开「调整布局」，可拖动卡片、标题和便签，或用方向键移动把手。人工位置会在刷新和 Agent 更新内容后保留。

<!-- anjian:en -->

#### English

Choose **Edit layout** to drag boards, titles, and sticky notes or move a focused handle with the arrow keys. Positions survive reloads and Agent source updates.

<!-- anjian:end -->

## 0.8.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

画板支持在同一页的板块之间添加带标签的方向箭头。可以让 Agent 串起多个界面，并标注跳转动作或条件。

<!-- anjian:en -->

#### English

Artboards can show labeled arrows between boards on the same page. Ask an Agent to connect screens and label each transition or condition.

<!-- anjian:end -->

### Patch Changes

<!-- anjian:zh -->

#### 中文

窄屏文档工具栏用紧凑按钮显示评论和历史，让批注恢复和分享保持可见。

<!-- anjian:en -->

#### English

The narrow document toolbar uses compact Comments and History buttons to keep Recover comments and Share in view.

<!-- anjian:end -->

## 0.7.4

### Patch Changes

<!-- anjian:zh -->

#### 中文

文档引用画板选择组时，会显示已提交的方案。打开卡片可跳到原选择组。

<!-- anjian:en -->

#### English

Document references to artboard choice groups show the submitted option. Open a reference card to jump to the original group.

<!-- anjian:end -->

## 0.7.3

### Patch Changes

<!-- anjian:zh -->

#### 中文

新建 HTML 作品时，文件监听器会保留同一份页面已上报的运行错误。实际修改源文件后，旧警告会清除。

<!-- anjian:en -->

#### English

A new HTML preview keeps runtime warnings reported before the first file watcher event. Editing the source still clears old warnings.

<!-- anjian:end -->

## 0.7.2

### Patch Changes

<!-- anjian:zh -->

#### 中文

恢复文件或切换、合并 Git 分支后，可在文档、画板、白板、幻灯片和分镜中核对并合并工作区带入的人工批注，也可以导入单独的批注备份。恢复保留原作者、时间、位置和删除记录。画板的验收和选项记录按当前证据管理。

<!-- anjian:en -->

#### English

After restoring files or switching or merging a Git branch, review and merge human comments from the workspace in documents, artboards, whiteboards, slide decks, and storyboards. You can also import a separate backup. Recovery keeps authors, timestamps, anchors, and deletion records. Artboard verdicts and choices use the current evidence.

<!-- anjian:end -->

## 0.7.1

### Patch Changes

<!-- anjian:zh -->

#### 中文

打开白板的「评论」或幻灯片的「本页批注」时，长讨论从最新消息开始显示。可以在评论卡片内向上滚动查看历史，回复和解决入口仍在消息区下方。

<!-- anjian:en -->

#### English

Long threads open at the latest message in whiteboard Comments and Slide comments. Scroll inside the thread to read earlier messages. Reply and resolution controls remain outside the message history.

<!-- anjian:end -->

## 0.7.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

验收报告支持一句结果摘要和常规检查汇总。相同构建及环境的结果可归在一起，命令与原始输出可按需展开。原始证据缺失或内容有变时，报告提示复核。

<!-- anjian:en -->

#### English

Verification reports can show one-line observations and a summary of routine checks. Results from the same build and environment appear together, with commands and raw output available in a disclosure. When the evidence changes or disappears, the report asks for a fresh review.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

验收报告可单列待确认的决定、理由和影响，并将同一画板的验收组汇总成一条状态，点击可回到画板。规格工作单保留到验收完成或分支合入。

<!-- anjian:en -->

#### English

Verification reports can list decisions that need your input, with their reasons and impact. They can also summarize review groups in one link per artboard. Spec workspaces stay available through verification or until the branch lands.

<!-- anjian:end -->

## 0.6.1

### Patch Changes

<!-- anjian:zh -->

#### 中文

本地文档问答通知会附上只读命令，Agent 可用它读取指定提交的全文。答案超出通知长度上限时，宿主仍会收到题目定位和读取命令。命令沿用原作品和接收会话的范围，文档改版后需要重新提交。

<!-- anjian:en -->

#### English

Local document question notifications include a read-only command for the exact submission. When the answer exceeds the notification limit, the host still receives the question location and the command to read the full answer. The command keeps the original worktree and recipient scope and asks for resubmission if the document has changed.

<!-- anjian:end -->

## 0.6.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

本地文档问答可以发送给已打开该文档的 Codex、Pi 或 Antigravity 会话。选定会话后点击「发送给…」，Agent 会收到题目、答案和文档修订。排队时可撤回并保留草稿。需要在文档里接收答复时，可以继续选用已连接的 Lody 会话。

<!-- anjian:en -->

#### English

Send a local document answer to the Codex, Pi, or Antigravity session that opened the document. Choose a session and select **Send to…** to deliver the question, answer, and document revision. You can withdraw a queued answer and keep the draft. Choose a connected Lody session to receive the Agent’s reply in the document.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

提交本地画板选择后，已订阅的 Codex、Pi 和 Antigravity 会话可以直接看到该轮的答案、推荐项和相关批注定位。通知保留读取完整反馈的命令，并保持该会话原有的已读状态。

<!-- anjian:en -->

#### English

When you submit a local artboard round, subscribed Codex, Pi, and Antigravity sessions can see the round's answers, defaults from recommendations, and related comment locations. The notification keeps the command for reading full feedback and preserves the session's read status.

<!-- anjian:end -->

## 0.5.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

新增 Antigravity CLI 反馈会话。可以为指定的本地文档和画板接收批注、选择提交与撤回通知，并用当前会话的回执读取待办。

<!-- anjian:en -->

#### English

Start an Antigravity CLI feedback session for selected local documents and artboards. It receives comment and choice updates and uses a session-specific receipt to read pending feedback.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

Agent 可用 `changes` 查看文档保留的版本，以及指定区间内人工编辑涉及的块和操作。用 `review` 可查看已保存的评审意见、引用位置和画板证据状态。两个命令都接受浏览器稳定地址或作品目录名，都有 JSON 输出，也可重复查询，保留原作品和评论未读状态。

<!-- anjian:en -->

#### English

Agents can use `changes` to list retained document versions and identify the blocks and operations involved in human edits over a selected range. The `review` command reports saved review comments, their locations, and the status of artboard evidence. Both commands accept stable browser addresses or directory slugs, support repeatable JSON queries and preserve artifact files and unread comments.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

可将排版、色彩、布局和组件规范保存为可复用的案间文档。验收报告可以固定所用规范的版本，将规则关联到检查结果或画板验收组，并标明尚未覆盖的规则。

<!-- anjian:en -->

#### English

Save typography, color, layout, and component rules as a reusable Anjian document. Verification reports can pin the exact specification revision, link rules to check results or artboard review groups, and identify rules without coverage.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

文档可以用批准题记录读者对当前修订的明确决定。决定保留批准人、选项和修订，设计变更后会提示重新评审。Agent 可用 `approval` 查看记录或在实施前核对当前修订是否获批。

<!-- anjian:en -->

#### English

Documents can include an approval question that records a reader's explicit decision for the current revision. Each decision retains the reviewer, choice, and revision. Design changes require a new review, and agents can use `approval` to inspect decisions or check that the current revision is approved before implementation.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

本地 HTML 预览支持主动将选中的文字发送给打开过该预览的 Codex 或 Claude Code 会话。发送保存当时的选区与作品版本，刷新或切换选区后，Agent 仍可读取已发送的快照。

<!-- anjian:en -->

#### English

Send selected text from a local HTML preview to a Codex or Claude Code session that opened the preview. Each send preserves the selection and artifact revision so the Agent can read the snapshot after the page refreshes or the selection changes.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

文档可加入带推荐项的选择题或开放题。读者可保存草稿并在重载后继续，明确提交给已连接的 Agent，也可在回复前撤回。提交保留当时的题目和答案，Agent 可在同一反馈任务回复，读者能在题目下看到结果。

<!-- anjian:en -->

#### English

Documents can include choice questions with a recommended option and open-ended questions. Readers can save and reload drafts, submit an answer to a connected Agent, or withdraw before a reply. Each submission preserves the question and answer as they were submitted. The Agent can reply in the same feedback task and readers can see the reply in the document.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

macOS 的 Apple 芯片和 Intel 机型可下载独立的案间安装包。解压后即可使用随包提供的运行时。发行页同时提供 SHA-256 校验文件，包内记录案间版本、源码提交和许可证。也可保留原有源码构建方式。

<!-- anjian:en -->

#### English

Anjian releases can include standalone downloads for Apple silicon and Intel Macs. The extracted package runs with its included runtime. Each release provides SHA-256 checksum files, and the package records its Anjian version, source commit, and licenses. Building from source remains supported.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

白板、幻灯片和分镜可以在编辑器里将选中的批注提交给已连接的 Lody Agent。用户可以查看进度、打开原批注并验收回传。批注保留页面、幻灯片或片段定位，重试同一结果只保留一条回复。

<!-- anjian:en -->

#### English

Submit selected whiteboard, slide deck, and storyboard comments to a connected Lody Agent from the editor. Track progress, reopen the original comment, and review the returned revision. Comments keep their page, slide, or clip anchors, and retrying the same result preserves a single reply.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

使用 `start --mockup` 启动画板时，Agent 会收到手机样机指南，可按目标尺寸和安全区在同一画板上比较手机界面方案。

<!-- anjian:en -->

#### English

Start an artboard with `start --mockup` to give the Agent a guide for comparing phone designs at the intended viewport size and safe-area insets.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

Pi 可通过 `/anjian-open` 或 `anjian_open` 打开文档和画板，并在当前会话接收评论、选择提交与撤回。订阅随 Pi 会话保存，通知保留手工读取评论的命令。

<!-- anjian:en -->

#### English

Use `/anjian-open` or `anjian_open` in Pi to open a document or artboard and receive comments, choice submissions, and withdrawals in the same session. Subscriptions follow the Pi session, and notifications include the command for reading the feedback manually.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

发布评审文档时，可选择一并公开的引用作品。读者打开的是这次发布保存的只读快照。未选入的引用仍显示名称，撤销文档分享会同时关闭其引用快照。

<!-- anjian:en -->

#### English

When publishing a review document, choose which referenced artifacts to include. Readers open read-only snapshots from that publication. References you leave out still show their labels. Revoking the document share also revokes its included snapshots.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

批注已读按 Agent 会话独立记录。全量查看保留未读状态，Agent 可确认快照中的指定线程。快照后新增或改动的消息继续显示为未读。文档和画板在消息旁标明 Agent 是否已读到当前版本。远程会话同时按授权设备隔离。

<!-- anjian:en -->

#### English

Comment read receipts are tracked per Agent session. A full listing leaves unread changes intact, and an Agent can confirm a specific thread from a saved snapshot. New or edited messages after the snapshot stay unread. Documents and artboards show when an Agent has read the current version of a message. Remote sessions are also scoped to the authorized device.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

新增可编辑的幻灯片作品。支持重排、按页批注、键盘翻页和同步的演讲者窗口。公开链接展示发布时的卡组，演讲者备注和批注保留在项目内。Agent 可以按幻灯片 ID 批注，自托管项目可以用 CLI 推拉卡组。

<!-- anjian:en -->

#### English

Create and edit slide decks with reordering, slide-level comments, keyboard navigation, and a synchronized presenter window. Public links show the published deck while speaker notes and comments stay private. Agents can comment by slide ID and push or pull decks in self-hosted projects.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

新增独立白板。可以在作品库新建白板，编辑 Excalidraw 场景，选择多个元素发起批注，并在重开后定位。Agent 可以推拉场景、读取和回复批注。公开分享使用只读快照。

<!-- anjian:en -->

#### English

Create a standalone whiteboard in the library, edit its Excalidraw scene, and comment on one or more elements. Reopen the board to find the same elements. Agents can pull and push scenes, read comments, and reply. Public links show a read-only snapshot.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

新增产品演示分镜。可导入媒体，在多条视频和音频轨道上调整片段、裁切和混音，并按片段保留评审。预览和 MP4 下载使用同一份合成结果。Agent 可以通过原生时间线及按片段批注协作，自托管项目支持推拉源文件和素材。

<!-- anjian:en -->

#### English

Create storyboards for product demo videos. Import media, arrange and trim clips across video and audio tracks, and keep feedback attached to clips. Preview and download the same rendered MP4. Agents can edit the native timeline and review clips, and self-hosted projects can sync the timeline and media.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

文档支持按稳定地址引用其他文档、HTML、画板、白板、幻灯片和分镜。打开画板引用可精确跳转到指定组或卡片，验收组显示当前状态。公开快照保留引用文字，目标作品的访问权限继续单独校验。

<!-- anjian:en -->

#### English

Documents can reference other documents, HTML previews, artboards, whiteboards, slides, and storyboards by stable address. Artboard references open the exact group or board, and verification groups show their current verdict. Public snapshots preserve the reference text, and access to the destination is checked independently.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

新增验收报告。案间可将机器检查的完整输出、构建与环境信息、画板验收和未验证事项生成可打开的文档。重新生成时，已变更或缺失的检查证据会标记待复核。画板引用显示当前人工判定。

<!-- anjian:en -->

#### English

Verification reports bring complete check output, build and environment details, artboard reviews, and coverage gaps into an Anjian document. Regenerating a report flags changed or missing check evidence for review. Linked artboard groups display their current human verdict.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

可在白板和公开快照中切换画框、复制画框链接。重新打开链接时会聚焦对应画框，画框移除后会提示并显示整个白板。

<!-- anjian:en -->

#### English

Switch between frames and copy links from whiteboards or published snapshots. Opening a link focuses that frame. If the frame has been removed, the page shows the whole whiteboard and explains why.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

白板支持新增和切换独立页面。各页单独保存修订，批注和画框链接可定位到对应页面。已有白板保留原场景作为默认页，自托管推拉和公开快照可包含多页。

<!-- anjian:en -->

#### English

Create and switch between whiteboard pages. Each page has its own scene revision, and comments and frame links can target a specific page. Existing whiteboards retain their original scene as the default page. Self-hosted sync and published snapshots can include multiple pages.

<!-- anjian:end -->

### Patch Changes

<!-- anjian:zh -->

#### 中文

修正 Antigravity 插件图标，补充从案间本地构建安装插件、打开作品和主动读取批注的说明。

<!-- anjian:en -->

#### English

Fix the Antigravity plugin icon and document how to install a local Anjian build, open artifacts, and read comments on demand.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

在当前 Codex 或 Claude Code 会话显式打开另一工作区的文档或画板后，该作品的批注和画板选择轮次会通知当前会话。通知命令指向实际作品所在的目录。一个工作区的批注暂时不可读时，其他工作区仍可收到通知。

<!-- anjian:en -->

#### English

After you explicitly open a document or artboard in another workspace from the current Codex or Claude Code session, that artifact's comments and artboard choice rounds notify the current session. The notification command points to the workspace that contains the artifact. Temporarily unavailable comments in one workspace do not delay notifications from other workspaces.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

作品库可在同一项目中创建白板、幻灯片和分镜。三类作品保留各自的编辑和批注入口。白板与幻灯片可以发布只读快照，分镜可下载渲染后的成片。

<!-- anjian:en -->

#### English

Create whiteboards, slide decks, and storyboards in the same project. Each type keeps its editing and review controls. Whiteboards and slide decks can publish read-only snapshots, and storyboards can download rendered videos.

<!-- anjian:end -->
<!-- anjian:zh -->

#### 中文

修复 Codex 本地反馈监听遗漏画板选择轮次的问题。同一批检测到的多个轮次会分别发送给已订阅的会话。Hub 注册工作区时会在五秒后结束未完成的请求，避免持续返回数据的响应让注册进程一直等待。

<!-- anjian:en -->

#### English

Fix missed Codex notifications when multiple artboard choice rounds are submitted between polls. Each round is delivered separately to the subscribed session. Local Hub project registration now stops unfinished requests after five seconds, including responses that keep streaming data.

<!-- anjian:end -->

## 0.4.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

文档与画板可将明确提交的反馈交给已连接的 Lody 会话：保留完整批注或选择轮次，显示待接收、处理中与待验收状态，并在作品内查看修改结果和原线程回复。支持暂停新任务、独立取消、显式恢复和用户验收；持久任务与执行代次保护避免重复处理和过期执行覆盖新结果。内置 Skill 提供连接、一次性等待和恢复指引，原手工流程保持可用。

<!-- anjian:en -->

#### English

Documents and artboards can send explicitly submitted feedback to a connected Lody session. Tasks preserve full comment threads or choice rounds, show receipt, execution and review states, and return revisions and replies inside the artifact. Pause new work, cancel a task, request recovery and accept results separately. Durable tasks and execution fencing prevent duplicate processing and stale writes. The built-in Skill explains connection, one-shot waiting and recovery while preserving manual workflows.
<!-- anjian:end -->

## 0.3.5

### Patch Changes

<!-- anjian:zh -->

#### 中文

修复手机端文档目录按钮的可访问名称：明确目录用途并包含当前可见标题，排除装饰性进度数值与淡出的标题，保留现有外观和导航行为。

<!-- anjian:en -->

#### English

Clarify the mobile documentation table-of-contents button's accessible name with its purpose and current visible label, excluding decorative progress values and faded titles while preserving its appearance and navigation behavior.

<!-- anjian:end -->

## 0.3.4

### Patch Changes

<!-- anjian:zh -->

#### 中文

修复文档搜索取消后键盘焦点丢失：返回打开前的可用控件，入口隐藏或移除时返回可见搜索入口或站点导航，保留搜索结果的页面与章节导航行为。

<!-- anjian:en -->

#### English

Restore keyboard focus after dismissing documentation search to the previously active control, with a visible search entry or site navigation as fallback when that control is hidden or removed. Preserve search result page and section navigation.

<!-- anjian:end -->

## 0.3.3

### Patch Changes

<!-- anjian:zh -->

#### 中文

修复 CLI 将缺少参数值、布尔选项附带值和不允许的位置参数误报为未知参数的问题，保留退出码、JSON/文本输出及正常参数行为。

<!-- anjian:en -->

#### English

Fix CLI diagnostics that mislabeled missing option values, values attached to boolean flags, and unexpected positional arguments as unknown arguments, preserving exit codes, JSON/text output, and valid argument behavior.

<!-- anjian:end -->

## 0.3.2

### Patch Changes

<!-- anjian:zh -->

文档切换语言时按明确的语义章节关系定位，保留原有中英文深链接及查询参数。键盘和新标签导航使用完整链接；旧文档链接按已保存语言跳转时复用章节映射。新增实际目录校验，防止标题修改静默破坏已发布的章节链接。

<!-- anjian:en -->

Map documentation anchors to their corresponding semantic sections when switching languages, preserving existing Chinese and English deep links and query parameters. Keyboard and new-tab navigation use complete links; legacy documentation redirects reuse the same mapping for saved language preferences. Validate compiled tables of contents to catch heading edits that would break published section links.

<!-- anjian:end -->

## 0.3.1

### Patch Changes

<!-- anjian:zh -->

#### 中文

网站的 Agent、设备与作品指引补充 CLI 内置 Skill 读取命令，说明复用有效绑定、等待用户批准配对，以及宿主加载和事件调度的边界。

<!-- anjian:en -->

#### English

Add built-in CLI Skill commands to the website's Agent, device, and artifact guides, clarifying binding reuse, waiting for user pairing approval, and host loading and event scheduling boundaries.

<!-- anjian:end -->

## 0.3.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

文档站提供全站中英切换：完整翻译首页、使用案例、17 篇文档、导航分组与公共界面，按当前语言搜索。统一语言入口保留对应页面并记住明确选择；新增明确语言 URL，兼容旧中文链接及英文更新说明链接。更新说明继续从同一份双语 CHANGELOG 生成，网站保持静态部署。

<!-- anjian:en -->

#### English

Add site-wide Chinese and English documentation, including the home page, use cases, all 17 guides, navigation groups, shared controls, and language-specific search. A consistent language switch keeps the corresponding page and remembers explicit choices. Language-prefixed URLs coexist with existing Chinese links and the legacy English release-notes link. Release notes still come from the single bilingual CHANGELOG, and the site remains statically deployable.

<!-- anjian:end -->

## 0.2.2

### Patch Changes

<!-- anjian:zh -->

#### 中文

文档站新增中英文更新说明与导航入口，构建时从正式发布记录生成静态页面；缺少翻译时显示原文和提示，无需访客实时访问 GitHub。

<!-- anjian:en -->

#### English

Add Chinese and English release notes and navigation to the documentation site. Static pages are generated from release records at build time, with original text and a notice when a translation is missing, without visitor requests to GitHub.

<!-- anjian:end -->

## 0.2.1

### Patch Changes

<!-- anjian:zh -->

#### 中文

将状态面板的更新说明移入独立阅读对话框，保留当前界面构建归属与语言回退提示。构建信息按界面和服务器分组，提交标识显示短值并可展开完整值，未知身份不再重复。状态内容与操作区分开，按动态视口和锚点限制高度，改善手机及低高度窗口中的滚动和底部操作可达性。

<!-- anjian:en -->

#### English

Move release notes from the status panel into a dedicated reading dialog, preserving interface build attribution and language fallback notices. Group build details by interface and server, show expandable short commit IDs, and avoid repeated unknown identity text. Separate scrolling status content from actions and size the panel against the dynamic viewport and its anchor to improve scrolling and access to bottom actions on phones and short windows.

<!-- anjian:end -->

## 0.2.0

### Minor Changes

<!-- anjian:zh -->

#### 中文

案间的运行状态面板新增本构建的版本、提交标识和离线更新说明，沿用已选择的界面语言。

开发者可通过 CLI 内置 Skill 获取接入指引，并独立查看 CLI 构建信息。Changesets 统一计算产品版本，同步应用和插件清单，生成中英发布记录。

保留现有 main 自动部署，非正式发布构建通过提交标识区分。创建 GitHub Release 不代表已部署；服务器升级不会自动升级本机 CLI，也不会发布 npm 包。

<!-- anjian:en -->

#### English

Anjian’s server status panel now includes the version, commit identity, and offline release notes for this build, using your selected interface language.

Developers can read integration guidance from the CLI’s bundled Skill and inspect the CLI’s own build information. Changesets calculates one product version, synchronizes application and plugin manifests, and generates release records in Chinese and English.

Existing automatic deployments from main remain enabled; commit identities distinguish builds between formal releases. A GitHub Release does not mean deployment is complete. Upgrading the server does not upgrade your local CLI, and this workflow does not publish npm packages.

<!-- anjian:end -->
