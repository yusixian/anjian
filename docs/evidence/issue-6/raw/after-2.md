我会对用户说：

“我会使用已发现的案间 CLI 读取内置指引，将 `/tmp/client-project` 接入 `https://boards.example.test`。设备授权发起后，我会提供实际审批链接，并等待你批准。”

先读取 `/tmp/client-project/AGENTS.md`（若存在），再依次执行以下命令，每步检查结果：

```bash
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs skills get artifacts
node /opt/anjian/bin/anjian.cjs skills get artifacts --reference remote.md
```

无需源码或全局安装 Skill。为后续命令使用同一入口和实际作品目录，定义当前 shell 函数：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}

anjian remote status
```

保留项目已经配置的 `ANJIAN_CLIENT_HOME`；没有配置则使用 CLI 默认目录，不读取凭据内容。未绑定不代表没有有效设备授权，因此先尝试：

```bash
anjian link --server https://boards.example.test
```

若返回缺少授权、已过期或已撤销，再读取 login 帮助并发起授权：

```bash
anjian login --help
anjian login https://boards.example.test --name "Agent device" --no-open
```

将 login 保持在支持持续运行的工具会话中。拿到输出后立即对用户说：

“请打开此次 login 返回的审批链接：〈实际 approval URL〉。在已登录你账号的浏览器中批准，选择你能授予且本次所需的全部可用项目及这些项目允许的现有作品操作。CLI 只能提交设备名称，不能请求 `--scope all` 或额外管理员角色，最终权限以审批页面和服务器授予结果为准。目前配对仍待批准，我会保持授权进程运行，等它明确报告成功后继续绑定。”

我不会编造 URL，不会把配对码当作浏览器登录，也不会在待批准时宣称接入完成。等待期间通过该会话读取进度；若配对过期，重新发起 login，提供新审批链接。

授权成功后，返回的唯一可访问项目为 `p1`，直接绑定并回读：

```bash
anjian link --server https://boards.example.test --project p1
anjian remote status
```

核实回读显示 `/tmp/client-project` 绑定到 `https://boards.example.test` 的 `p1`，然后对用户说：

“已将 `/tmp/client-project` 绑定到 `https://boards.example.test` 的项目 `p1`，并通过 `remote status` 回读确认。服务器本次返回的可访问项目只有 `p1`。本次完成授权和绑定，尚未上传作品。”

在 `/tmp/client-project/AGENTS.md` 中记录 CLI 入口、作品目录 `/tmp/client-project/.anjian/artifacts`、服务器 origin 和实际私有配置目录路径；只记录路径和无密钥 origin，不记录 token、访问 key 或审批链接。
