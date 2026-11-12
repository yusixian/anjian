我会对用户说：

> 我会按案间 artifacts Skill 和远程接入指引操作，使用已找到的 `/opt/anjian/bin/anjian.cjs`，把 `/tmp/client-project` 绑定到你的服务器。设备授权需要你在浏览器批准；批准期间我会保持登录进程运行。

先读 `/tmp/client-project/AGENTS.md`，检查项目路径和是否配置了 `ANJIAN_CLIENT_HOME`。发现没有 wrapper，也没有全局 Skill 或源码时，不假定存在 `skills/artifacts/app/anjian.cjs`；使用已发现的可用 CLI，查看帮助确认入口。当前评估中已经完整读取的两份指引作为操作依据，不声称已在该项目安装 Skill。

计划执行：

```bash
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs login --help
```

定义仅用于当前 shell 的入口；如果项目配置了私有 `ANJIAN_CLIENT_HOME`，每次调用保留该配置，否则使用默认客户端目录：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}

anjian remote status
```

状态已知为未绑定，接着启动：

```bash
anjian login https://boards.example.test \
  --name "Agent device" --no-open
```

登录帮助只提供 `name` 和 `no-open`，因此不会添加猜测出来的权限参数。拿到真实输出后对用户说：

> 请打开登录命令输出的配对地址，在已登录管理员账号的浏览器中批准这台设备。你要求尽量覆盖账号可授权的项目，请在授权页面勾选希望授予此设备的项目；具体范围由页面可选项决定。登录进程会保持运行，批准成功后我继续绑定。

配对地址只引用实际输出，不虚构。若浏览器要求访问 key，请用户先在同一浏览器打开已有的完整访问链接，不要求其把 key 发到聊天里，也不读取部署凭据。

授权等待期间保持登录进程运行，轮询该进程结果，不提前执行 `link`。若配对过期，重新启动登录流程并提供新的配对地址。

登录确认成功后执行：

```bash
anjian link --server https://boards.example.test
```

题设给定批准后只可访问项目 `p1`。如果命令自动绑定唯一项目，则直接检查结果；如果返回项目列表等待选择，则执行：

```bash
anjian link --server https://boards.example.test --project p1
```

最后回读：

```bash
anjian remote status
```

只有回读确认服务器为 `https://boards.example.test`、项目为 `p1`，且绑定对应 `/tmp/client-project`，才对用户说：

> `/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，并通过状态回读确认。批准后 CLI 当前只显示一个可访问项目 `p1`，因此不能确认设备获得了账号的全部项目权限。本次完成接入，尚未上传作品。

以上是场景决策，未执行任何配对、联网或绑定命令。
