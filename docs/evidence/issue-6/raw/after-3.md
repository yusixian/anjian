我会先说：

> 我会使用已发现的 CLI 为 `/tmp/client-project` 接入案间，并读取它内置的操作指引。授权页面由你批准；我会等 CLI 确认成功，再绑定项目并回读验证。

先读取 `/tmp/client-project/AGENTS.md`（若存在），然后依次执行：

```bash
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs skills get artifacts
node /opt/anjian/bin/anjian.cjs skills get artifacts --reference remote.md
```

没有源码或全局 Skill 不妨碍读取 CLI 内置指引。后续使用同一入口和真实作品目录：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}
anjian remote status
```

如果项目指引配置了 `ANJIAN_CLIENT_HOME`，所有命令沿用该路径；否则使用 CLI 默认目录，不读取凭据内容。

已知状态未绑定。如果目标服务器已有有效设备授权，先尝试：

```bash
anjian link --server https://boards.example.test
```

如果缺少有效授权，则读取登录帮助并启动配对：

```bash
anjian login --help
anjian login https://boards.example.test --name "Agent device" --no-open
```

保持登录进程在受支持的持久会话中运行。配对待批准时对用户说：

> 请打开登录进程实际返回的批准链接：〈原样提供实际 approval URL〉，在已登录你账号的浏览器中批准。按你的要求，请选择页面中你有权授予的所有可用项目及其允许的作品操作。当前 CLI 不支持 `--scope all` 或权限级别参数，实际授权范围由批准页面和服务器响应决定。当前仍在等待批准，尚未完成接入。

不把配对码当成浏览器登录，不另取部署密钥，也不在待批准阶段执行绑定或声称成功。若配对过期，重新启动登录并提供新的实际批准链接。

CLI 确认授权成功后，返回的可访问项目只有 `p1`，直接选择：

```bash
anjian link --server https://boards.example.test --project p1
anjian remote status
```

检查绑定结果及状态回读，确认服务器为 `https://boards.example.test`、项目为 `p1`。仅当两者一致且状态有效时说：

> `/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，状态回读验证通过。服务器此次返回的可访问项目只有 `p1`；这不代表获得了额外管理员权限。此次完成了授权和绑定，尚未上传作品或验证远程同步。

以上是场景中的操作决定；未执行配对或其他场景命令。
