我会先说明：“我会按案间 artifacts Skill 的远程接入指引操作，使用已发现的 CLI，把 `/tmp/client-project` 绑定到你指定的服务器。”

先检查项目约定和 CLI 随附指引：

```bash
cat /tmp/client-project/AGENTS.md
rg --files --hidden /opt/anjian -g SKILL.md -g remote.md
node /opt/anjian/bin/anjian.cjs --help
```

若安装目录包含 artifacts Skill，就完整读取其 `SKILL.md` 和 `remote.md`。没有找到时，不声称已安装全局 Skill；本次评估已经提供并读取这两份指引，可以据此继续。原始指引没有提供额外的 Skill 下载或安装命令。

使用已知可用的 CLI，明确指定用户作品项目：

```bash
anjian() {
  node /opt/anjian/bin/anjian.cjs "$@" \
    --project-dir /tmp/client-project --json
}

anjian remote status
anjian login --help
```

已知 status 未绑定、login 只提供 `name/no-open`，因此不添加猜测的权限参数，执行：

```bash
anjian login https://boards.example.test \
  --name "Agent device" --no-open
```

保留这个进程，在工具支持的持久会话里等待批准。向用户说：

“设备配对已发起，请打开 CLI 输出的授权地址，在管理员已登录的浏览器中批准。你要求授予账号能够授权的全部项目权限，请在授权页面选择这些项目；CLI 没有额外的权限参数。若页面要求访问密钥，请先在同一浏览器打开你已有的完整访问链接，不要把密钥发到聊天里。我会保持配对进程运行，批准成功后继续绑定。”

实际回复附上 CLI 原样输出的配对地址。不会读取部署密钥或代替用户批准。配对待批准期间不运行 `link`；配对过期才重新发起登录。

配对进程确认成功后执行：

```bash
anjian link --server https://boards.example.test
```

检查返回结果。如果已自动绑定唯一可访问的项目 `p1`，直接回读；如果返回项目列表、尚未完成绑定，则执行：

```bash
anjian link --server https://boards.example.test --project p1
```

最后回读：

```bash
anjian remote status
```

确认返回的服务器是 `https://boards.example.test`、远程项目是 `p1`，且使用的本地项目目录是 `/tmp/client-project`。

成功后告诉用户：

“`/tmp/client-project` 已绑定到 `https://boards.example.test` 的项目 `p1`，已通过 `remote status` 回读确认。此次设备授权后可访问的项目只有 `p1`；我无法据此确认账号是否还有其他项目或更高权限。本次完成了授权和绑定，尚未上传作品。”

以上仅为场景决策，未执行配对、绑定或其他场景命令。
