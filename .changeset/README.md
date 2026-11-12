# 案间版本变更 / Anjian changesets

每项用户变化在一个 changeset 中同时写中文与英文，只版本化私有根产品 `anjian-workflow`。运行 `pnpm changeset` 选择升级级别，然后按 `versioned-releases.md` 的语言标记填写相同范围的事实。保留 `<!-- anjian:zh -->`、`<!-- anjian:en -->`、`<!-- anjian:end -->` 及中文 / English 标题。破坏性变化必须明确；纯文档或测试整理可不升级。

Write Chinese and English descriptions of the same change in one changeset. Only the private root product is versioned. Keep the language markers and headings shown in the initial changeset. Explain breaking changes explicitly. Documentation-only and test-only maintenance may omit a version bump.

`pnpm release:version` validates both languages, runs the pinned Changesets CLI, and synchronizes every field in `.version-bump.json`. Do not edit versions independently or run npm publish. The generated `CHANGELOG.md` supplies GitHub Release text and each build’s offline notes; no separate English list is maintained.
