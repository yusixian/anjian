# Anjian 本地安装

从案间 GitHub Releases 获取适合你的 macOS 或 Linux 安装包，也可以从本仓库源码构建。[Anjian Releases](https://github.com/yusixian/anjian/releases)

## macOS 安装包

Apple 芯片使用 `darwin-arm64`，Intel 使用 `darwin-x64`。运行 `uname -m` 可查看当前终端架构。下载同一发行页上对应的 `.tar.gz` 和 `.tar.gz.sha256`。发行流程分别在 Apple 芯片和 Intel 的 macOS 15 环境中验证安装包。

以下以 Apple 芯片为例，将 `版本` 替换为实际版本号。

```bash
file=anjian-v版本-darwin-arm64
shasum -a 256 -c "$file.tar.gz.sha256"
tar -xzf "$file.tar.gz"
"./$file/anjian" version
"./$file/anjian" start --project-dir /绝对路径/项目 --no-open --background
"./$file/anjian" stop
```

包内附 Node.js、构建信息和许可证，解压后即可使用。录屏裁剪等功能仍需系统提供 `ffmpeg` 和 `ffprobe`。

离线更新时，先将新版归档和校验文件复制到目标机器。用旧版执行 `stop`，将新版解压到另一个目录，核对 `version` 后从新目录启动。作品和服务状态独立于安装目录。保留旧版目录即可再次使用旧入口。没有安装包的发行仍可使用该版本的源码。

## Linux 安装包

在使用 glibc 的 Linux 上，按 `uname -m` 的结果选择 `linux-x64`（`x86_64`）或 `linux-arm64`（`aarch64`）。从同一个发行页下载归档和 SHA-256 校验文件。发行流程在原生 Ubuntu 24.04 x64 和 arm64 上验证两种包。

以 x64 为例，将 `版本` 替换为实际版本号。

```bash
file=anjian-v版本-linux-x64
sha256sum -c "$file.tar.gz.sha256"
tar -xzf "$file.tar.gz"
"./$file/anjian" version
"./$file/anjian" start --project-dir /绝对路径/项目 --no-open --background
"./$file/anjian" stop
```

包内自带 Node.js。录屏裁剪等功能需要系统提供 `ffmpeg` 和 `ffprobe`。需要让 Hub 随用户会话启动时，先停止手工启动的 Hub，再用解压目录里的 `anjian service install` 安装用户服务。更新安装路径时，先用旧版卸载服务，再用新版安装。服务器部署也可以继续走[容器方式](self-hosting.md)。

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

也可以在宿主中加载 `skills/artifacts/`，或显式读取其 `SKILL.md`。CLI 可读取 Skill 不代表宿主自动加载或自动执行；仅克隆仓库同样不会让所有新会话加载指引。Antigravity CLI 可使用[案间反馈会话](antigravity-feedback.md)接收本地作品批注。

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

## Pi 反馈

先完成案间源码构建，然后在 Pi 安装这份本地包。

```bash
pi install /绝对路径/anjian
```

在 Pi 中输入 `/anjian-open document/plan` 或 `/anjian-open artboard/design`。Agent 也可以调用 `anjian_open`。默认使用当前作品项目目录。跨项目时在命令末尾附上目录，或给工具传 `projectDir`。

经该入口打开的文档和画板会订阅到当前会话。普通评论、画板选择提交和撤回会排在当前 Pi 回复之后。重新打开同一会话会恢复当前分支的订阅。切换会话或用 `/tree` 返回尚未打开作品的分支时，原订阅停止通知。

反馈保存在作品中。通知里的命令可手工读取。也可以在 Pi 中用 `/session` 查看会话 ID。运行命令前将它设为 `PI_SESSION_ID`。

```bash
anjian comment list --artifact document/plan --session "pi:$PI_SESSION_ID" --json
```

## GitHub Copilot CLI

从案间源码将完整的 `skills/artifacts/` 安装到作品项目的 `.github/skills/artifacts/`，用 `copilot skill list` 核对加载。运行入口、预览和手动回读见[文档站 Copilot 指南](https://anjian.cosine.ren/zh/docs/agent/#github-copilot-cli)。

## Antigravity CLI

构建案间后，用本地源码目录安装插件。重新构建后，重新安装以更新 Antigravity 持有的插件副本。

```bash
agy plugin install /绝对路径/anjian
agy plugin list --json
```

确认列表中的 `anjian` 已启用且包含 `artifacts`。普通 `agy` 会话可以按需读取已安装的案间指引和作品批注。需要自动接收本地文档和画板反馈时，使用[案间反馈会话](antigravity-feedback.md)启动 `agy` 并传入作品参数。

以上本地宿主入口使用本机案间 Hub。自托管项目使用[设备绑定和远程反馈](../skills/artifacts/remote.md)。
