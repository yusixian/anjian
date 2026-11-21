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

## 查看人工改动与评审

```bash
node skills/artifacts/app/anjian.cjs changes --project-dir /绝对路径/项目 --artifact document/design --versions --json
node skills/artifacts/app/anjian.cjs changes --project-dir /绝对路径/项目 --artifact document/design --from "$START_VERSION" --to "$END_VERSION" --json
node skills/artifacts/app/anjian.cjs review --project-dir /绝对路径/项目 --artifact artboard/design --json
```

从 `--versions` 的结果复制同一文档的版本标识。省略 `--to` 会查询到服务端记录的最新版本。结果包含 Loro 编辑者标识、已记录的时间、文档块和操作 ID。来源未知的记录另行计数，只有保留了历史的区间可查询。

`review` 适用于文档和画板。它返回已保存的评论及其位置，还可查看画板的选择和验收状态。两条命令均保留作品和评论的未读状态，可通过本地服务或已绑定的自托管项目运行。
