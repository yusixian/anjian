我会先说：

> 我会按 artifacts Skill 的远程接入指引，将 `/tmp/client-project` 接到 `https://boards.example.test`。本机已有可用 CLI，我会使用它；项目目录始终显式指定。

先读取 `/tmp/client-project/AGENTS.md`（若存在），确认是否配置私有 `ANJIAN_CLIENT_HOME`。当前没有 wrapper、源码或全局 Skill，不尝试构建源码，也不安装未经验证的 npm 包。这里已完整阅读评估提供的 `skills/artifacts/SKILL.md` 与 `remote.md`；不会据此声称 Skill 已全局安装。原指引没有提供从独立 CLI 导出或安装 Skill 的发现命令。

为本次会话定义入口：

```sh
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}
```

如果项目配置了 `ANJIAN_CLIENT_HOME`，后续命令保留该配置。未配置则使用 CLI 默认目录，不读取或输出凭据文件。

```sh
anjian remote status
anjian login --help
anjian login https://boards.example.test --name "Agent device" --no-open
```

已知 status 未绑定；login help 只有 `name`、`no-open`，所以不添加猜测的权限参数。保持 login 进程存活，取得配对页面地址后立即告诉用户：

> 配对申请已发起，请打开 CLI 返回的配对页面，用管理员身份批准本设备。你要求尽量授权账号可提供的所有项目，请在页面选择相应项目范围；实际权限以服务端允许并由你批准的范围为准。我会保持申请进程运行，等 CLI 确认授权成功后继续绑定。若页面要求访问 key，请先在同一浏览器打开你已有的完整访问链接，不要把 key 发到聊天里。

配对尚待批准时不执行 link，不把用户催促视为批准完成。若配对过期，重新发起 login，并提供新页面地址。

login 确认成功后执行：

```sh
anjian link --server https://boards.example.test
```

该命令若直接绑定唯一可访问项目 `p1`，检查结果后继续；若返回项目列表并要求指定 ID，则执行：

```sh
anjian link --server https://boards.example.test --project p1
```

最后回读：

```sh
anjian remote status
```

只有回读确认服务器是 `https://boards.example.test`、项目是 `p1` 且对应 `/tmp/client-project`，才告诉用户：

> `/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，已通过 `remote status` 回读确认。本次授权后 CLI 只列出一个可访问项目 `p1`；不能据此确认账号所有项目权限都已授予。此次只完成接入，尚未上传作品。

以上仅为场景决策，未执行接入命令或真实配对。
