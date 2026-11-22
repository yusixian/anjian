# 独立白板入口的 Skill 对照

给独立评估会话的任务是把本地流程草图转成可编辑的图，并说明如何定位两个批注元素。另一位协作者此时在修改第三个元素。

基线 `04d711a` 的 Skill 可以选择文档图块或 HTML 画板。文档批注定位到正文块。HTML 画板评审依赖 DOM 路径和页面坐标。基线 CLI 也无法读取 `whiteboard.md`，其批注帮助只列出文档和画板。

候选 Skill 选择 `whiteboard/onboarding`，写入 `scene.excalidraw`，通过 `start --artifact whiteboard/onboarding` 给出直达链接。保存前重读场景并基于最新元素合并，保留同事对其他元素的编辑。通过 `comment list` 把 `anchor.elementIds` 对照到 `elements[].id`，再以 `--thread` 回复。元素已删除时在回复里说明，保留原锚点。自托管改动走现有推拉修订检查。

此对照核对宿主指引和可调用入口。文件保存、评论和冲突行为由 HTTP、CLI 和浏览器验收覆盖。

## 画框直达链接

让评估会话为已有白板中的评审画框提供一个能放进文档的链接，并要求接收者继续经过原项目权限。基线 `77c0caa` 的白板指南能给出作品链接和元素批注定位，缺少画框 URL 契约。候选指南从已保存的 `frame` 元素取稳定 ID，将它编码到规范作品链接的 `frame` 查询参数，并移除会话参数。现有文档可以用普通链接打开它。需要公开访问时，从已发布快照中复制同一画框的链接。

## 白板多页

让独立评估会话在已有白板中添加 Review 页，保留 Main，并在两页的元素 ID 相同时把批注和画框链接定位到 Review。最后让评估会话检查在 Review 仍未发布时能交付什么链接。

基线 `647e6fa` 只说明单个场景和 `frame` 参数。候选指南先写 `pages/review.excalidraw`，再将该页追加到 `pages.json`。评估会话用 `comment add --page review --elements "$element"` 写入批注，再用返回的 `anchor.page` 和 `elementIds` 确认目标。链接用 `page=review` 和已保存画框 ID。Chrome 验证旧的匿名快照会提示 Review 未发布，也不会跳到主页面的同 ID 画框。真实 CLI 验证了可对 Review 的元素留言并回复。
