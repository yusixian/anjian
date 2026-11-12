# 案间文档站

中英产品文档，使用 Next.js、Fumadocs UI 与 MDX，构建为独立静态站点。品牌与视觉来源是 `../docs/brand/HANDOFF.md` 和 `../docs/brand/design-src/gen_docs.py`。

在本目录执行（Node.js 22、pnpm 10.28.2）：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发地址为 `http://127.0.0.1:3100`。检查与导出：

```bash
pnpm typecheck
pnpm build
pnpm test
```

`test` 检查构建产物中的内部链接、资源、双语翻译覆盖与搜索索引，需要先运行 `build`。页面交互、深浅主题和移动布局还需浏览器验证。

语言路由为 `/zh/`、`/en/`，包括同路径下的 `docs/` 与 `use-cases/`。URL 中的明确语言始终优先于偏好；只有点击全站语言入口才写入 `localStorage` 的 `anjian.docs.language`。旧 `/`、`/docs/*`、`/use-cases/` 保留中文静态内容，浏览器加载后用 `location.replace` 转入已保存语言（没有选择时中文），不额外占用历史记录。旧 `/docs/updates-en/` 固定进入 `/en/docs/updates/`，不受偏好覆盖。切换保留对应路径和查询，将已知章节 hash 映射到目标语言的同一语义章节；未知或非法编码的 hash 原样保留。普通点击及 Enter 保存语言偏好；修饰键和中键打开新标签不改偏好，链接本身包含完整查询与章节。刷新和历史导航以 URL 为准。禁用存储时仍可按 URL 切换；禁用 JavaScript 时旧中文页可读，英文旧入口提供明确链接。

章节对应关系维护在 `lib/doc-anchor-map.mjs`，按页面与语义键显式配对，不依赖标题顺序。文档布局使用 Fumadocs 实际编译 TOC 校验双语覆盖、ID 唯一性及映射目标；更新说明按 CHANGELOG 版本身份生成对应关系。修改标题文案时保留原锚点，例如 `## 新标题 [#原ID]`，不要仅刷新映射使旧链接失效；新增章节需人工确认语义并补充对应关系。重复标题需要各自唯一且稳定的 ID，重排前用显式 ID 保留旧链接。新增或改动文案后运行上述构建和测试，并验证章节切换的实际滚动位置。

Fumadocs 16.18.4 的 loader `i18n` 管理语言正文和分组，`fallbackLanguage: null` 禁止漏译时套用中文。`RootProvider` 传当前 locale 和对应 UI 翻译；默认搜索组件自动从 provider 取 locale，`createFromSource().staticGET` 导出带语言过滤的索引，无运行时 middleware。MDX 正文链接由共享渲染器加语言前缀，图片与工作台 `/library` 不加前缀。

更新说明位于 `/zh/docs/updates/` 和 `/en/docs/updates/`。`scripts/release-pages.mjs` 在安装、开发、类型检查与构建前读取根目录 `CHANGELOG.md`，复用 `scripts/release/notes.mjs` 解析正式版本。现有版本必须双语完整，测试会拒绝缺译；解析器保留未来历史缺译时的明确提示。生成的 `content/docs/updates.mdx`、`updates.en.mdx` 不提交，不手工维护，并清除旧生成名 `updates-en.mdx`。发布流程更新 CHANGELOG 后，下次站点构建自动带入新版本，访客无需请求 GitHub。构建上下文须包含上述根目录文件，不能只复制 `website/`。

将 `out/` 部署到站点根路径的静态托管服务；文档不需要案间后端或登录。静态服务器需按目录提供 `index.html`，并正常提供 `/api/search` 静态 JSON。可本地验证：

```bash
python3 -m http.server 3100 --bind 127.0.0.1 --directory out
```

- `content/docs/`：MDX 指南；`meta.json` / `meta.en.json` 定义对应语言分组与同一导航顺序。
- `app/[lang]/use-cases/`：带原图链接的案例页；对应文字指南参与全文搜索。
- `components/illustrations.tsx`：从定稿提取的静态工作台和作品插画，不具备产品操作功能。
- `app/global.css`：品牌令牌、定稿样式及 Fumadocs 适配。
- `public/anjian*.svg`：浅深主题品牌图标；favicon 固定浅色。

截图来自用户授权的真实案例，保留原始内容。文档和此站点按根目录 MIT 许可；案间应用按 `artifacts/LICENSE` 的 AGPL-3.0-only 许可。

生产镜像同时构建文档站，并通过 `ANJIAN_DOCS_DIR=/app/website/out` 启用：

| 路径                               | 用途                          |
| ---------------------------------- | ----------------------------- |
| `/`                                | 公开产品与文档首页            |
| `/zh/docs/`、`/en/docs/`           | 使用指南（旧 `/docs/` 兼容）  |
| `/zh/use-cases/`、`/en/use-cases/` | 案例（旧 `/use-cases/` 兼容） |
| `/library`                         | 需要登录的作品库              |

原有作品、分享、登录、设备授权、API 与 WebSocket 地址保持不变。只开放文档导出目录的指定路由，不公开工作台数据。未配置 `ANJIAN_DOCS_DIR` 的本地服务仍以作品库作为首页。
