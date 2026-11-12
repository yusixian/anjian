我会使用已发现的 CLI，把 `/tmp/client-project` 明确作为作品项目；没有源码或全局 Skill 不影响接入。以下仅是场景中的决定，不执行命令。

先读取项目存在的 `AGENTS.md`，保留其中配置的 `ANJIAN_CLIENT_HOME`，再通过 CLI 获取完整运行指引：

```bash
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs skills get artifacts
node /opt/anjian/bin/anjian.cjs skills get artifacts --reference remote.md
```

为后续命令固定入口和项目：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}
anjian remote status
```

题设返回未绑定。若已有该服务器的有效设备授权，直接尝试 `link`；若没有有效授权，则查看登录帮助并发起配对：

```bash
anjian login --help
anjian login https://boards.example.test --name "Agent device" --no-open
```

登录命令运行在可持续保留的工具会话中。向用户展示此次命令实际返回的批准 URL，并说：

> 请打开这个批准链接：〈CLI 实际返回的批准 URL〉。在浏览器中登录你的账号，选择你能授权的全部所需项目及这些项目允许的现有作品操作。当前还在等待批准，我会保留配对进程，成功后继续绑定。CLI 没有申请“全部权限”的参数，也不会额外申请管理员角色；最终权限以浏览器批准和服务器返回结果为准。

不添加 `--scope all` 等帮助中不存在的参数，不读取部署密钥或其他项目凭据。用户尚未批准时，不执行依赖授权的绑定，也不报告登录成功。继续读取同一个进程的输出；配对过期则重新发起登录，提供新的实际批准 URL。

只有 CLI 明确报告授权成功后，继续绑定。批准后仅返回项目 `p1`，目标没有歧义，直接选择：

```bash
anjian link --server https://boards.example.test --project p1
anjian remote status
```

检查 `link` 成功及状态回读中的服务器 origin、项目 ID 和本地项目目录。三者分别确认是 `https://boards.example.test`、`p1`、`/tmp/client-project` 后，对用户说：

> `/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，绑定后已回读确认。本次授权返回的可访问项目只有 `p1`。目前完成了接入，尚未上传作品或验证跨设备同步。

若状态回读不符，则报告具体不一致并继续排查，不宣称接入完成。
