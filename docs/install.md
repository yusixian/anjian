# Anjian 本地安装

本项目尚未发布 npm 包或插件市场版本。请使用这份源码，避免安装同名的未知软件包或上游 Ryugi 最新版。

## 构建与运行

在仓库根目录执行：

```bash
cd artifacts
pnpm install --frozen-lockfile
pnpm build
node dist/cli.cjs start --project-dir /绝对路径/项目 --no-open --foreground
```

使用支持此锁定依赖的 Node.js 版本和 pnpm；容器配置使用 Node 22 与 pnpm 10.28.2。实际验证环境及结果见 ../docs/DELIVERY_GOAL.md。

把启动输出中的完整 URL 复制到浏览器。前台进程需要保持运行；退出不会删除作品。作品位于项目的 `.anjian/artifacts/`，服务状态默认位于 `~/.anjian/server/`。

也可以从仓库根目录调用 Agent 使用的启动器：

```bash
node skills/artifacts/app/anjian.cjs start --project-dir /绝对路径/项目 --no-open --foreground --json
```

启动器仅运行本地构建；没有构建产物时会报错并提供构建指引，不查询或安装上游发行包。

## Agent 集成

`skills/`、`hooks/` 和各宿主插件目录已迁移到 Anjian 命名。选择宿主支持的本地插件加载方式，指向本仓库；不要照搬历史文档中的上游 marketplace 安装地址。

首要验收流程是：Agent 写入本地作品，启动工作台，用户批注，Agent 运行 `comment list` 读取批注并更新作品。后台通知钩子是额外集成，仍需在实际宿主中单独验证；CLI 可运行不代表宿主自动唤醒已经成功。

远程部署不自动同步本机文件。自托管边界见 [self-hosting.md](self-hosting.md)。
