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

构建后的 CLI 自带与构建时源码一致的完整 Skill，无需在作品项目里放置源码或全局安装 Skill：

```bash
node /绝对路径/anjian/artifacts/dist/cli.cjs --help
node /绝对路径/anjian/artifacts/dist/cli.cjs skills list
node /绝对路径/anjian/artifacts/dist/cli.cjs skills get artifacts
node /绝对路径/anjian/artifacts/dist/cli.cjs skills get artifacts --reference remote.md
```

`get` 默认完整输出 Markdown（管道中也一样），加 `--json` 输出包含 `content`、`command` 和 `reference` 的结构。`list` 列出允许的参考名称，包括可运行示例；只能读取这些内嵌资源，不能传任意文件路径。输出标明当前可执行入口，相对文档链接用 `--reference` 继续读取。源码启动器和打包后的 `bin/anjian.cjs` 支持相同命令；读取 Skill 和帮助不启动服务、打开浏览器、注册批注订阅或写入授权。

也可以在宿主中加载 `skills/artifacts/`，或显式读取其 `SKILL.md`。CLI 可读取 Skill 不代表宿主自动加载或自动执行；仅克隆仓库同样不会让所有新会话加载指引。

在实际作品项目的 `AGENTS.md` 加入以下入口说明，替换成自己的绝对路径。若已有固定项目与客户端目录的包装器，直接记录包装器路径即可。

```markdown
CLI：node /绝对路径/anjian/skills/artifacts/app/anjian.cjs
处理案间作品或网页批注前，用上述 CLI 执行 skills get artifacts。
远程任务继续执行 skills get artifacts --reference remote.md。
项目：/绝对路径/作品项目（所有命令传 --project-dir）。
服务器：https://你的案间域名
客户端配置：默认 ~/.anjian/client/；如果使用自定义 ANJIAN_CLIENT_HOME，所有命令保持一致。
先运行 remote status --json；有效绑定直接复用。未授权时 Agent 发起 login，保持进程等待用户在浏览器批准，再 link 并回读状态。
不要输出或提交凭证。watch 只输出事件，不会自动唤醒宿主。
```

Agent 自行发现入口并完成接入命令；仅服务器未知或项目选择确有歧义时询问。用户在浏览器批准账号可授予的所需全部项目；当前协议只有设备名称与项目列表，没有 `--scope all` 或权限级别参数。已有有效绑定不为扩权而撤销重绑。

已有远程作品使用「读取批注 → pull → 编辑 → push → check → 回复」。冲突、本地未同步改动和浏览器授权处理见 [Agent 远程操作参考](../skills/artifacts/remote.md)。本地模式仍使用文件写入和本地服务器。后台通知钩子是额外集成，需在宿主中单独验证。服务器部署不会更新本机 CLI；修改 Skill 后须重新构建并交付客户端产物。
