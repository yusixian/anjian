---
'anjian-workflow': patch
---

<!-- anjian:zh -->

#### 中文

文档引用可用 `block="decision"` 指向目标文档中 `id="decision"` 的顶层块。点击本篇引用可跳转并用浏览器返回，引用其他文档时桌面打开只读侧栏，窄屏打开目标文档并定位。若目标块已删除，引用会提示并打开有权查看的文档首页。查看编写示例可执行 `anjian skills get artifacts --reference document.md`。

<!-- anjian:en -->

#### English

Use `block="decision"` on a document reference to target a top-level block with `id="decision"`. Within the same document, the link jumps to the block and browser Back restores your place. Other documents open in a read-only pane on desktop or at the block on narrow screens. If the block is gone, the link explains this and opens the document for readers with access. Run `anjian skills get artifacts --reference document.md` for an example.

<!-- anjian:end -->
