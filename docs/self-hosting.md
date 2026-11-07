# Anjian 自托管

当前为部署准备稿。Compose 配置已通过静态解析；镜像构建、反向代理及 Dokploy 线上运行尚待实际验收。不要把本文件当成已完成部署的报告。

## 两个来源

主界面与可执行 HTML 预览使用不同 origin，避免作品脚本获得主界面的同源权限。

| 服务 | 容器端口 | 示例域名 | 配置 |
| --- | --- | --- | --- |
| 作品库、文档、评论 API 与 WebSocket | 27319 | `https://anjian.example.com` | `ANJIAN_PUBLIC_ORIGIN` |
| HTML / 画板预览 | 27329 | `https://preview.example.net` | `ANJIAN_BOARD_ORIGIN` |

origin 是协议、主机和可选端口，不含路径或查询参数。公网部署需为两个来源提供 HTTPS，反向代理需支持 WebSocket。示例不是已分配的域名；建议为可执行预览选择独立站点，实际隔离效果还需浏览器验证。

## 本机容器

```bash
docker compose up --build -d
docker compose logs anjian
```

Compose 默认仅将 27319、27329 绑定到服务器回环地址。浏览器使用启动输出中的完整地址与访问密钥，不要将访问密钥公开分享。容器进程以非 root 用户运行。

容器内注册的项目为 `/data/project`。把作品放在 `/data/project/.anjian/artifacts/`；服务状态和访问密钥在 `/data/server`。两者都在 `anjian-data` 命名卷内。

## Dokploy

1. 创建基于本项目源码的 Docker Compose 应用，使用根目录 `compose.yaml`。
2. 为 `anjian` 服务分别配置主界面与预览域名，转发到 27319 和 27329。
3. 将实际 HTTPS origin 写入 `ANJIAN_PUBLIC_ORIGIN` 与 `ANJIAN_BOARD_ORIGIN`，随后部署。
4. 保留命名卷。需要备份时使用 Dokploy 的 Volume Backups，并实际验证恢复。
5. 同时检查部署记录与运行中容器，再验收首页、预览、WebSocket、评论保存和重启后内容恢复。

### main 自动部署

为 Anjian 单独创建应用并连接自己的 GitHub 仓库：

- 分支：`main`；构建路径：`/`；Compose 文件：`compose.yaml`。
- 开启 Autodeploy，Trigger Type 选择 `On Push`。
- 保持 GitHub App 对该仓库的访问权限。首次部署后，通过一次 main 更新确认 webhook、构建记录与运行版本都对应同一提交。

直接推送 main 和合并 PR 到 main 都会产生 push 事件；其他分支的推送不应触发该生产应用。On Push 不会等待 GitHub Actions 完成。推荐为 main 配置 PR 检查门槛，通过仓库的 `Anjian checks` 后再合入。

当前仓库与应用尚未创建，以上是待应用的配置，不代表 webhook 已经验证。

Dokploy 的部署任务显示完成只表示部署命令结束，不证明应用已经可用。域名路由与命名卷用法参考 [Dokploy Compose 文档](https://docs.dokploy.com/docs/core/docker-compose)和[域名配置](https://docs.dokploy.com/docs/core/docker-compose/domains)。

## 本地 Agent 与远程工作台

远程容器看不到电脑上的项目文件。当前本地 CLI 操作本机项目和服务，不应把远程网页可访问解释成远程 Agent 集成已完成。

完整连接需要验证两个方向：

- 作品文件从本地项目送达远程项目，更新不覆盖服务端保存的评论和状态。
- 远程评论回到正确的本地 Agent 会话；网络断开与重复投递不能导致反馈丢失。

实现前不建议用双向目录同步覆盖整个 `.anjian/artifacts/`：这里既有 Agent 写入的作品，也有服务器管理的评论、编辑状态与会话文件。需要明确文件所有权，或用专门的上传和反馈接口。

第一阶段先验收同机闭环，再实现远程传输。此部分仍是待完成项。
## 首次远程连接：通过 SSH 执行容器内 CLI

第一版可使用已有 SSH 访问执行服务器容器中的 CLI，不需要重新引入官方中继。以下是待部署后验收的操作方案，尚未验证真实 SSH 连接。

先在服务器的 Anjian Compose 目录确认服务名称与项目路径，再执行：

```bash
docker compose exec -T anjian node /app/artifacts/dist/cli.cjs comment list \
  --project-dir /data/project --artifact document/plan --all
```

本地 Agent 可通过 SSH 在同一服务器、同一 Compose 目录执行这条命令，并用 `comment reply` 回复。SSH 账号、主机和 Compose 目录必须由实际部署确定，不要将 Dokploy 网页登录视为 SSH 授权。访问密钥留在服务器状态目录，命令不需要把它复制到聊天中。

文件编辑也必须作用于容器所注册的 `/data/project/.anjian/artifacts/`。首轮可以在远程工作区运行 Agent，或逐个传输明确归 Agent 管理的作品文件；不要上传整个 `.state`、评论文件或覆盖服务器状态。文档应先读取远程当前版本再修改，防止覆盖网页编辑。

验收顺序：浏览器写批注 → SSH 执行 CLI 读取 → 更新远程作品 → CLI 回复 → 浏览器实时显示 → 重启容器后再次读取。此方案提供显式拉取反馈；宿主自动通知、断线续传和本地目录自动同步仍需单独实现与验证。
