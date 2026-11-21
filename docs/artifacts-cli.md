# Anjian CLI

CLI 来自 `artifacts/` 的本地构建，未发布到 npm。以下命令从仓库根目录运行。

```bash
node skills/artifacts/app/anjian.cjs --help
node skills/artifacts/app/anjian.cjs start --project-dir /绝对路径/项目 --foreground --no-open --json
node skills/artifacts/app/anjian.cjs check --project-dir /绝对路径/项目 --artifact document/design --json
node skills/artifacts/app/anjian.cjs comment list --project-dir /绝对路径/项目 --artifact document/design --json
node skills/artifacts/app/anjian.cjs stop --json
```

`start` 在本机服务中注册项目，`check` 检查作品，`comment` 读取和处理评论、选择与提交，`stop` 停止本机共享服务。具体参数以 `<command> --help` 为准。

作品目录：`<项目>/.anjian/artifacts/`。服务状态：`~/.anjian/server/`，可由 `ANJIAN_SERVER_HOME` 修改。此目录与上游 Ryugi 的状态隔离。

在 Codex 或 Claude Code 的案间启动器中用 `start --project-dir <目录> --artifact <作品>`，成功打开后将该作品的本地反馈订阅到当前会话。订阅与 Hub 状态目录分开，启动器和监听器须使用相同的 `ANJIAN_RUNTIME_DIR`（如果配置了该变量），订阅索引按用户主目录解析相对路径。当嵌套宿主同时提供两种会话 ID 时，在启动器调用中设置 `ANJIAN_COMMENT_HOST=codex` 或 `ANJIAN_COMMENT_HOST=claude`，以选择实际接收会话。

## 批注已读状态

Codex 和 Claude Code 的 `comment list` 使用当前会话的已读状态。其他客户端可传 `--session <id>`。相同作品的不同会话独立确认，远程调用同时按已授权设备隔离。无会话的调用沿用旧游标。

`list --all` 查看完整线程并保留未读状态。需要先看变更、再确认某个线程时，使用 `--peek` 保存 JSON 快照，随后用 `comment read` 确认。快照后新到或修改的消息仍待阅读。
文档和画板中的「Agent 已读」表明有会话确认过消息的当前版本。修改消息后会清除该提示，直到新版本被确认。

## 从本地 HTML 预览发送选区

从 Codex 或 Claude Code 会话运行 `start --project-dir <项目> --artifact html/<作品>`，在打开的 HTML 页面选中文字，再点击「发送选区」。多个会话同时打开同一作品时，选择器用宿主名称和会话 ID 的后六位标识目标。需要新的上下文时重新选中文字。

Agent 收到作品名和快照路径，可以读取点击时的选区、元素位置及预览版本。预览刷新、失焦切换到别的标签页或内容版本更新后，需要重新选择。发送提示表示快照已交给宿主队列或监听器。

```bash
node skills/artifacts/app/anjian.cjs comment list --artifact document/design --session review-1 --peek --json > comments.json
node skills/artifacts/app/anjian.cjs comment read --artifact document/design --snapshot comments.json --thread < 线程ID > --json
```

本项目不提供官方云登录、`publish`、云链接 `get`、自动发布配置或上游 `update` 命令。更新由用户从本项目源码构建并自行部署。

非回环地址启动时必须保留输出链接中的访问密钥。不要把这个链接贴到公开渠道。HTTPS 部署使用独立主界面和 HTML 预览 origin，见 [self-hosting.md](self-hosting.md)。
