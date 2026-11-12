以下是场景中的执行决定；未实际运行命令或配对。

先对用户说：

“我会使用现有 CLI 内置的 artifacts 指引接入 `/tmp/client-project`。我正在使用 artifacts Skill；设备授权需要你在浏览器批准，我会保持配对进程运行，批准成功后完成项目绑定并回读确认。”

先读取 `/tmp/client-project/AGENTS.md`（若存在），然后逐条执行：

```bash
node /opt/anjian/bin/anjian.cjs --help
node /opt/anjian/bin/anjian.cjs skills get artifacts
node /opt/anjian/bin/anjian.cjs skills get artifacts --reference remote.md
```

不需要源码、全局 Skill 或安装 npm 包。采用当前会话函数，固定实际作品目录：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}
anjian remote status
```

保留项目已配置的 `ANJIAN_CLIENT_HOME`；没有配置则使用 CLI 默认目录，不读取凭据内容。

状态未绑定不等于没有有效设备授权。如果状态显示目标服务器已有有效设备凭据，先尝试：

```bash
anjian link --server https://boards.example.test
```

若没有有效授权，读取 login 帮助并启动配对：

```bash
anjian login --help
anjian login https://boards.example.test --name "Agent device" --no-open
```

使用支持持续运行的进程会话，保持 login 存活。将实际输出的批准 URL 原样提供给用户，不编造链接。对用户说：

“配对正在等待批准，尚未授权成功。请打开 CLI 输出的批准链接，在已登录你账号的浏览器中，选择你能授予的所有所需可用项目，并允许这些项目授权所支持的现有作品操作。实际权限以批准页面和服务器返回为准。当前 CLI 只支持设备名称，没有 `--scope all` 或权限等级参数，也不能请求新增管理员角色。批准后我会继续绑定并核验。”

如果批准页需要登录，由用户登录或在浏览器打开已有完整访问链接；不获取部署密钥或其他项目凭据。等待期间不执行依赖成功授权的 link，不把配对码当浏览器登录。如果配对过期，重新启动 login 并提供新的实际批准 URL。

只有 login 明确成功后才继续。服务器返回唯一可访问项目 `p1`，直接选择：

```bash
anjian link --server https://boards.example.test --project p1
anjian remote status
```

逐项检查结果，确认回读绑定的本地目录为 `/tmp/client-project`、origin 为 `https://boards.example.test`、项目为 `p1`。确认成功后对用户说：

“`/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，并已通过状态回读确认。服务器此次返回的可访问项目只有 `p1`；实际权限以该设备获批的项目授权为准。此次完成的是接入绑定，尚未上传作品。”
