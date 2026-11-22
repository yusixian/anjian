# Antigravity CLI 接收案间反馈

构建案间，并确保 `agy` 可直接启动。案间会为传入的现有文档或画板显示链接，并启动一个使用 Antigravity 流式输入的独立会话。

```bash
node /绝对路径/anjian/skills/artifacts/app/antigravity-session.cjs \
  --project-dir /绝对路径/作品项目 --artifact document/plan --artifact artboard/design
```

在终端输入一行继续对话。网页批注及画板选择提交、撤回会在当前回复结束后进入该会话。终端启动时会显示回执 ID，结束会话用 Ctrl+D。要处理多个项目，在各自目录启动独立会话。

自动投递沿用 Antigravity 的工具权限。当前配置需要人工批准终端命令时，可以在另一终端运行通知中的读取命令，再回到会话继续；也可以在 Antigravity 中为所需的只读命令配置[项目权限](https://antigravity.google/docs/cli-permissions)。手工读取时，把下面的 `agy:UUID` 替换为启动时显示的完整回执 ID。

```bash
node /绝对路径/anjian/skills/artifacts/app/anjian.cjs comment list \
  --project-dir /绝对路径/作品项目 --artifact document/plan --session agy:UUID --json
```

这一入口接收本地案间 Hub 的反馈，适用于由它启动的 Antigravity 会话。已有的普通 `agy` 交互终端仍可主动读取批注。自托管项目继续使用[设备绑定和远程反馈](../skills/artifacts/remote.md)。
