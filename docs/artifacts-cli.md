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

## 复用设计规范

把已经选定的排版、色彩、布局和组件规则写进 JSON。为每条规则保留固定 ID，并记录决策来源，例如验收组、代码提交或团队决定。

```json
{
  "rules": [
    {
      "id": "wrap-reference-title",
      "category": "layout",
      "title": "长标题换行",
      "requirement": "390px 视口内长标题可换行，页面无横向滚动。",
      "source": "引用卡片评审，案间 ArtifactReferenceCard.tsx"
    }
  ],
  "schema": 1,
  "title": "作品引用卡片"
}
```

```bash
anjian design-spec --input design.json
anjian design-spec --input design.json --json
anjian verify-report --input report.json --output .anjian/artifacts/document/review/doc.xml
```

将第一条命令生成的 XML 保存到规范文档。第二条命令给出精确的 `revision`，可用于验收报告。保留规范 JSON 和原始证据文件，避免修改过去的报告输入。更改规则时另存一份规范文件，保留规则 ID，并在新版的 `previous` 字段记录上一版摘要。

在验收报告输入中增加 `designSpec`，字段包括相对于报告 JSON 的 `file`、规范的 `revision`，以及规范文档的稳定地址 `target`。在每条检查或人工验收项增加 `rules` 数组，填写相应规则 ID。报告会标明未覆盖的规则。人工验收项通过画板链接展示当前状态。

## 确认设计批准

在文档中用 `<ask approve="ship">` 标记批准题，`approve` 的值对应允许实施的选项 ID。其他选项会记录为需要修改。请明确选择并提交，案间会记录该决定对应的文档修订和批准人。

```xml
<ask key="implementation" prompt="是否批准实施这版设计？"
     options='[{"id":"ship","label":"批准实施"},{"id":"revise","label":"需要修改"}]'
     approve="ship" />
```

```bash
anjian approval --artifact "document/$DOCUMENT_ID" --json
anjian approval --artifact "document/$DOCUMENT_ID" --require implementation --json
```

将浏览器文档地址的最后一段设为 `DOCUMENT_ID`。第一条命令显示当前修订和决定历史。实施前用第二条命令核对指定题目，只有当前修订获批才会返回退出码 0。自托管项目可将返回的修订同 `remote pull` 返回的修订核对。文档或随附资源变更后，需要对新修订重新作出决定。附件发生变化时，先在浏览器重新打开文档，确认加载的是新版附件。

## 查看人工改动与评审

```bash
node skills/artifacts/app/anjian.cjs changes --project-dir /绝对路径/项目 --artifact document/design --versions --json
node skills/artifacts/app/anjian.cjs changes --project-dir /绝对路径/项目 --artifact document/design --from "$START_VERSION" --to "$END_VERSION" --json
node skills/artifacts/app/anjian.cjs review --project-dir /绝对路径/项目 --artifact artboard/design --json
```

从 `--versions` 的结果复制同一文档的版本标识。省略 `--to` 会查询到服务端记录的最新版本。结果包含 Loro 编辑者标识、已记录的时间、文档块和操作 ID。来源未知的记录另行计数，只有保留了历史的区间可查询。

`review` 适用于文档和画板。它返回已保存的评论及其位置，还可查看画板的选择和验收状态。两条命令均保留作品和评论的未读状态，可通过本地服务或已绑定的自托管项目运行。

验收报告保存规范文件及检查输出的摘要。`approval --require` 核对当前文档与附件的修订。作品引用打开链接目标，目标作品的最新验收通过 `review --artifact artboard/<id>` 检查。部署前可分别核对设计批准与画板验收。
