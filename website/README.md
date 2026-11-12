# 案间文档站

中文产品文档，使用 Next.js、Fumadocs UI 与 MDX，构建为独立静态站点。品牌与视觉来源是 `../docs/brand/HANDOFF.md` 和 `../docs/brand/design-src/gen_docs.py`。

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

`test` 检查构建产物中的内部链接、资源与中文搜索索引，需要先运行 `build`。页面交互、深浅主题和移动布局还需浏览器验证。

更新说明位于 `/docs/updates/`（中文默认）和 `/docs/updates-en/`（英文）。`scripts/release-pages.mjs` 在安装、开发、类型检查与构建前读取根目录 `CHANGELOG.md`，复用 `scripts/release/notes.mjs` 解析正式版本；缺译时显示另一语言或原文并提示。生成的 `content/docs/updates*.mdx` 不提交，不手工维护。发布流程更新 CHANGELOG 后，下次站点构建会自动带入新版本，访客无需请求 GitHub。构建上下文须包含上述根目录文件，不能只复制 `website/`。

将 `out/` 部署到站点根路径的静态托管服务；文档不需要案间后端或登录。静态服务器需按目录提供 `index.html`，并正常提供 `/api/search` 静态 JSON。可本地验证：

```bash
python3 -m http.server 3100 --bind 127.0.0.1 --directory out
```

- `content/docs/`：MDX 指南；`meta.json` 定义导航顺序。
- `app/use-cases/`：带原图链接的案例页；对应文字指南参与全文搜索。
- `components/illustrations.tsx`：从定稿提取的静态工作台和作品插画，不具备产品操作功能。
- `app/global.css`：品牌令牌、定稿样式及 Fumadocs 适配。
- `public/anjian*.svg`：浅深主题品牌图标；favicon 固定浅色。

截图来自用户授权的真实案例，保留原始内容。文档和此站点按根目录 MIT 许可；案间应用按 `artifacts/LICENSE` 的 AGPL-3.0-only 许可。

生产镜像同时构建文档站，并通过 `ANJIAN_DOCS_DIR=/app/website/out` 启用：

| 路径          | 用途               |
| ------------- | ------------------ |
| `/`           | 公开产品与文档首页 |
| `/docs/`      | 使用指南           |
| `/use-cases/` | 案例               |
| `/library`    | 需要登录的作品库   |

原有作品、分享、登录、设备授权、API 与 WebSocket 地址保持不变。只开放文档导出目录的指定路由，不公开工作台数据。未配置 `ANJIAN_DOCS_DIR` 的本地服务仍以作品库作为首页。
