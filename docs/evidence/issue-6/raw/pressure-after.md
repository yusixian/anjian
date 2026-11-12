以下仅为决策输出，没有执行场景命令，也未授权或读取凭据。

共用准备步骤：读取 `/tmp/client-project/AGENTS.md`（若存在），保留其中配置的私有客户端目录；使用已找到的 CLI，无需用户找命令：

```bash
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs skills get artifacts
node /opt/anjian/bin/anjian.cjs skills get artifacts --reference remote.md
```

实际操作统一显式指定 `--project-dir /tmp/client-project --json`。不使用本源码仓库作为作品项目。

**A：已有有效绑定**

复用已确认的 `https://boards.example.test`、`p1` 和有效 session，立即继续已授权的作品操作。无需 login、重新配对或等待用户。若需要重新核对：

```bash
node /opt/anjian/bin/anjian.cjs remote status --project-dir /tmp/client-project --json
```

对用户说：

> 已有有效连接，目标是 boards.example.test 的 p1，我直接沿用它继续演示准备。当前协议没有额外的“全部权限”参数，现有授权可用，不需要重新配对。

作品 ID 和类型尚未提供，因此不虚构具体 push 命令或成功链接。

**B：未绑定、无设备授权，服务器已知**

自行启动授权：

```bash
node /opt/anjian/bin/anjian.cjs login https://boards.example.test --name "Agent device" --no-open --project-dir /tmp/client-project --json
```

将进程保持在支持的持久会话中。只有拿到实际输出后才展示实际 approval URL，并对用户说：

> 请打开这个授权链接，在你的账号中批准设备，选择本次需要且你能够授予的所有可用项目及其现有作品操作权限。授权需要你在浏览器完成；我会保持命令运行，收到成功结果后继续绑定。

此时等待浏览器批准和 CLI 成功；pending 不算成功，过期则重新运行 login。不索取部署 key，也不编造 `--scope all`。

CLI 确认授权成功后：

```bash
node /opt/anjian/bin/anjian.cjs link --server https://boards.example.test --project-dir /tmp/client-project --json
```

返回 p1/p2 且无法对应当前项目时停止绑定选择，对用户说：

> 账号已授权，但服务器返回 p1 和 p2，现有信息无法判断哪个对应 `/tmp/client-project`。请指定目标项目；这决定作品上传位置，我不能猜选。

等待明确项目 ID。假设用户选 p2，随后执行：

```bash
node /opt/anjian/bin/anjian.cjs link --server https://boards.example.test --project p2 --project-dir /tmp/client-project --json
node /opt/anjian/bin/anjian.cjs remote status --project-dir /tmp/client-project --json
```

确认 origin、projectId 和有效绑定，再继续作品操作。

**C：未绑定、服务器 origin 未知**

先检查项目指引；若仍无 origin，不启动 login，不沿用另一个独立场景的域名，不读取其他项目凭据。

对用户说：

> 请提供这次演示使用的案间服务器地址，例如 `https://你的域名`。目前没有绑定，也没有目标服务器信息；拿到地址后我会自行运行授权和绑定命令。

等待 origin 后，按 B 的授权流程继续。五分钟演示期限和“别再问”不提供缺失的服务器地址，也不能替代浏览器批准或消除项目选择歧义。
