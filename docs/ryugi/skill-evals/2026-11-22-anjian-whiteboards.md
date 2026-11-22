# 独立白板入口的 Skill 对照

给独立评估会话的任务是把本地流程草图转成可编辑的图，并说明如何定位两个批注元素。另一位协作者此时在修改第三个元素。

基线 `04d711a` 的 Skill 可以选择文档图块或 HTML 画板。文档批注定位到正文块。HTML 画板评审依赖 DOM 路径和页面坐标。基线 CLI 也无法读取 `whiteboard.md`，其批注帮助只列出文档和画板。

候选 Skill 选择 `whiteboard/onboarding`，写入 `scene.excalidraw`，通过 `start --artifact whiteboard/onboarding` 给出直达链接。保存前重读场景并基于最新元素合并，保留同事对其他元素的编辑。通过 `comment list` 把 `anchor.elementIds` 对照到 `elements[].id`，再以 `--thread` 回复。元素已删除时在回复里说明，保留原锚点。自托管改动走现有推拉修订检查。

此对照核对宿主指引和可调用入口。文件保存、评论和冲突行为由 HTTP、CLI 和浏览器验收覆盖。
