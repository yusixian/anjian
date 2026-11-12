---
'anjian-workflow': minor
---

<!-- anjian:zh -->

#### 中文

案间的运行状态面板新增本构建的版本、提交标识和离线更新说明，沿用已选择的界面语言。

开发者可通过 CLI 内置 Skill 获取接入指引，并独立查看 CLI 构建信息。Changesets 统一计算产品版本，同步应用和插件清单，生成中英发布记录。

自托管部署需要绑定通过检查的版本提交。创建 GitHub Release 不代表已部署；服务器升级不会自动升级本机 CLI，也不会发布 npm 包。

<!-- anjian:en -->

#### English

Anjian’s server status panel now includes the version, commit identity, and offline release notes for this build, using your selected interface language.

Developers can read integration guidance from the CLI’s bundled Skill and inspect the CLI’s own build information. Changesets calculates one product version, synchronizes application and plugin manifests, and generates release records in Chinese and English.

Self-hosted deployments must use a version commit that has passed checks. A GitHub Release does not mean deployment is complete. Upgrading the server does not upgrade your local CLI, and this workflow does not publish npm packages.

<!-- anjian:end -->
