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

本项目不提供官方云登录、`publish`、云链接 `get`、自动发布配置或上游 `update` 命令。更新由用户从本项目源码构建并自行部署。

非回环地址启动时必须保留输出链接中的访问密钥。不要把这个链接贴到公开渠道。HTTPS 部署使用独立主界面和 HTML 预览 origin，见 [self-hosting.md](self-hosting.md)。

## 确认设计批准

在文档中用 `<ask approve="ship">` 标记批准题，`approve` 的值对应允许实施的选项 ID。其他选项会记录为需要修改。请明确选择并提交，案间会记录该决定对应的文档修订和批准人。

```xml
<ask key="implementation" prompt="是否批准实施这版设计？"
     options='[{"id":"ship","label":"批准实施"},{"id":"revise","label":"需要修改"}]'
     approve="ship" />
```

```bash
anjian approval --artifact document/ < 稳定地址 > --json
anjian approval --artifact document/ implementation --json < 稳定地址 > --require
```

使用浏览器文档地址最后一段作为稳定地址。第一条命令显示当前修订和决定历史。实施前用第二条命令核对指定题目，只有当前修订获批才会返回退出码 0。自托管项目可将返回的修订同 `remote pull` 返回的修订核对。文档或随附资源变更后，需要对新修订重新作出决定。附件发生变化时，先在浏览器重新打开文档，确认加载的是新版附件。
