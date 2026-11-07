# Anjian — 项目约定

Anjian（案间）从 Ryugi v1.51.2 分叉，独立维护。目标是个人使用、中文体验、本地运行与自有服务器部署。README.md 描述产品，docs/DELIVERY_GOAL.md 保存交付状态，UPSTREAM.md 保留来源记录。

## 产品边界

- 核心能力：画板、文档、HTML 预览、评论及 Agent 反馈。
- 不接入官方 Ryugi Cloud，不增加订阅、官方登录或官方包自动更新。
- 自有服务器属于支持方向。不要把本地链接可打开当成跨设备同步或 Agent 通知成功。
- 启动器只运行本地构建。没有构建时给出本仓库的安装/构建指引，不下载上游发行包。
- 存储与协议使用 Anjian 命名空间，不读写原 Ryugi 的运行状态或终止其服务。

## 实现与验证

- 主要应用在 `artifacts/`，CLI、服务端、viewer 和 runtime 分目录维护。
- 在 `artifacts/` 下执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- Vitest 的 global setup 会构建完整应用；不要并发运行多个全量构建。
- 受影响测试先行，再按实际影响扩大；前端要在实际浏览器检查桌面与手机布局。
- 新增网络入口保留来源校验与访问密钥；HTML 预览使用与主界面隔离的 origin。
- Skills 是运行时指引。行为修改用 `.claude/skills/writing-skills/SKILL.md` 的前后对照方法验证，并保留证据；不要改动无关的工作流约束。
- 中文是初始默认语言，保留已有明确语言选择。不要把机器可解析的字段名翻译为中文。

## 交付

- 默认只改本地工作区，提交、推送和部署分别遵循用户授权。
- 不使用上游 npm 名称或维护者身份发布；本项目的包暂标记 private。
- 本地检查、浏览器验收、容器构建和线上部署分别记录。待验证项不能写成已完成。

## 来源与许可证

- 保留 Ryugi 与 Superpowers 的来源、版权声明以及基线提交。
- Skills、集成与文档按根目录 LICENSE；artifacts 应用及产物按 artifacts/LICENSE（AGPL-3.0-only）。
- 重命名不改变继承代码许可证；新增应用依赖须与 AGPL 兼容。
- 后续上游代码逐项核对授权，不默认适用 v1.51.2 的许可证。
