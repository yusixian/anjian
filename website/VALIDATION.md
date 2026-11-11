# 本地验证记录 · 2026-11-11

本次实现依据 `docs/brand/HANDOFF.md`、`design-src/gen_docs.py` 和已核验的设计稿 revision `sha256:9bedeeb7ad457a2f28e93bd8ddf2c88eb2b83f1cac7b486ef3231ed65882c72b`。

## 自动检查

- `artifacts/`：`pnpm typecheck`、`pnpm test --maxWorkers=4`、`pnpm build` 全部通过；222 个测试文件、1,796 项测试通过。
- `website/`：`pnpm typecheck`、`pnpm build`、`pnpm test` 通过。测试检查全部导出页面的本地链接、资源及中文搜索索引。
- `bash tests/antigravity/test-logo.sh` 通过，包括重新渲染 PNG 的一致性检查。
- `git diff --check` 通过。

## 浏览器检查

使用本机 Chrome 无头模式访问 `website/out/` 静态产物，视口宽度为 1440、768、390、320，分别检查浅色和深色主题的首页、本机使用、邀请朋友、使用案例：32 个状态均无横向溢出、图片加载错误或页面脚本异常。深色主题的可见品牌图片均为 `anjian-dark.svg`。已人工查看代表性的桌面、手机截图。

实际操作通过：中文搜索并跳转「邀请朋友」、复制安装命令、主题切换并刷新保留、手机文档抽屉导航、手机页内目录跳转、手机菜单切换主题与 Escape 关闭。

另以临时数据目录启动本次构建的案间服务，检查 1440、390 宽度的深浅主题。每页三个品牌标志共六个遮罩 ID，均不重复。测试实例已关闭，不使用现有作品数据。

本机临时证据位于 `/tmp/anjian-docs-evidence/`；页面检查记录为 `/tmp/anjian-docs-browser.log`，交互记录为 `/tmp/anjian-docs-final-interactions.log`，应用测试记录为 `/tmp/anjian-c2-tests.log`。这些是临时文件，不随仓库分发。

## 首轮本地验证范围

以上记录对应首轮本地构建与 Chrome 响应式检查；当时未提交或部署。未进行实体手机、Safari 或 Firefox 验证。

## 文档首页发布前补充

已移除顶栏「文档」标签，新增 `/library` 工作台入口，并在容器中启用公开静态文档路由。类型检查通过；文档站构建与两项产物测试通过；路由、登录及 Hub 的 39 项针对性测试通过。应用全量结果为 1,796 项通过、1 项 CLI 评论测试超时；该文件和新增文档路由测试以单 worker 复测，17 项全部通过。

Chrome 集成检查覆盖 1440/390px、深浅主题的「首页 → 登录 → 作品库」和中文搜索跳转，页面无脚本异常或 HTTP 错误。额外确认 Next 首页 RSC 导航数据可公开读取，而私有 API、路径越界和符号链接仍受限制。本机 Docker daemon 未运行，容器构建将在生产部署中验证。

## 恢复 Fumadocs 标准阅读布局

上一版已通过 PR #3 合入并部署（main `9443d833`）。生产 Chrome 的桌面、手机、深浅主题、搜索、登录跳转及原公开分享链接检查通过，现有远程 CLI 绑定仍有效。

本轮移除阅读页的自定义顶栏、手机导航、页内目录、翻页组件和布局覆盖，使用 Fumadocs 原生布局。首页仍保留产品介绍。网站 typecheck、build、test 通过；Chrome 在 1440、1024、390px 的深浅主题中验证了侧栏可见性、页内目录、手机抽屉、搜索与主题切换。截图和脚本分别位于本机 `/tmp/anjian-docs-evidence/fumadocs-local-*`、`/tmp/anjian-fumadocs-browser.mjs`。
