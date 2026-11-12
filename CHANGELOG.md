# anjian-workflow

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
