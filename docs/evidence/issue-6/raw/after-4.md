以下仅为场景中的操作决定；未执行命令、访问网络或真实配对。

先对用户说：

> 我会使用已发现的案间 CLI，为 `/tmp/client-project` 接入指定服务器，并从 CLI 读取内置操作指引。授权需要你在浏览器批准；批准成功后，我会绑定可访问项目并回读验证。

依次执行，逐条检查结果：

```bash
cat /tmp/client-project/AGENTS.md
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs skills get artifacts
node /opt/anjian/bin/anjian.cjs skills get artifacts --reference remote.md
```

没有全局 Skill、源码或 wrapper 不构成阻碍，使用上述 CLI 内置指引。后续统一使用：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}
anjian remote status
```

如果项目配置了 `ANJIAN_CLIENT_HOME`，每条命令保留该配置；否则使用 CLI 默认目录，不读取凭据文件。

状态未绑定时，如果服务器已有有效设备授权，先尝试：

```bash
anjian link --server https://boards.example.test
```

若缺少有效授权，则查看帮助并启动登录：

```bash
anjian login --help
anjian login https://boards.example.test --name "Agent device" --no-open
```

将登录进程保留在支持持续运行的工具会话中。当前配对待批准，因此继续等待该进程，不重复启动登录，也不执行 `link`。

对用户说：

> 请打开登录进程实际返回的批准链接：〈实际 approval URL〉，在已登录你账号的浏览器中批准这个设备。请在页面允许的范围内，选择你希望授予的全部可用项目及这些项目允许的现有作品操作。CLI 只提交设备名称，没有 `--scope all` 或权限级别参数；最终权限由浏览器批准和服务器返回结果决定。目前配对仍待批准，尚未接入完成。

不会编造批准 URL、索取部署 key 或其他项目凭据。如果批准页面需要登录，由用户自行登录；配对码不作为浏览器登录凭证。

等待登录进程明确报告成功后，唯一可访问项目为 `p1`，直接绑定，无须再询问项目选择：

```bash
anjian link --server https://boards.example.test --project p1
anjian remote status
```

确认回读结果中的服务器为 `https://boards.example.test`、项目为 `p1`，且绑定有效，才对用户说：

> `/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，设备授权已成功，绑定信息已回读确认。本次返回的可访问项目只有 `p1`。尚未上传作品。

若配对过期，重新发起登录并提供新批准链接；未获成功结果前，不进入绑定步骤，也不报告完成。
