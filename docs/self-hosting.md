# Anjian 自托管

已在 Dokploy 验证源码镜像构建、运行中容器、主界面 HTTPS 与文档批注/CLI 回复。main 推送已实际触发自动部署。容器重启后文档与评论保留已验证；线上画板独立来源已验证，容器替换后的卷恢复未验证；HTTPS 远程 CLI 已完成公网浏览器与本地 CLI 闭环验收，详见 [交付记录](DELIVERY_GOAL.md)。

## 两个来源

画板预览使用独立 HTTPS origin。独立 HTML 作品通过不含 allow-same-origin 的 iframe 沙箱加载，使用不透明来源。两条路径均限制作品脚本取得主界面的同源权限。

| 服务 | 容器端口 | 示例域名 | 配置 |
| --- | --- | --- | --- |
| 作品库、文档、评论 API 与 WebSocket | 27319 | `https://anjian.example.com` | `ANJIAN_PUBLIC_ORIGIN` |
| 画板预览 | 27329 | `https://preview.example.net` | `ANJIAN_BOARD_ORIGIN` |

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

公开仓库 `yusixian/anjian` 与 Dokploy Anjian Compose 应用已创建，上述来源配置已保存。提交 `e74e1fa78ee8859a4e4485c98626813c5ede7b17` 已通过 main webhook 自动触发部署，Dokploy 记录显示 Done。

Dokploy 的部署任务显示完成只表示部署命令结束，不证明应用已经可用。域名路由与命名卷用法参考 [Dokploy Compose 文档](https://docs.dokploy.com/docs/core/docker-compose)和[域名配置](https://docs.dokploy.com/docs/core/docker-compose/domains)。

## 本地 Agent 与远程工作台

远程 CLI 通过设备配对取得可撤销的项目凭证，经 HTTPS 上传作品、读取批注和回复。使用方式见 [远程 CLI](remote-cli.md)。SSH 仅用于服务器运维，不再是产品连接方案。

客户端只传输作品源码和资源，不同步服务器的评论、历史或会话状态。版本冲突会拒绝覆盖；事件监听保留游标，断线后可以续接。宿主 Agent 的自动调度与 CLI 事件输出是两个层次。

新增设备授权记录和事件日志位于服务状态目录，必须和 `/data/project` 一起保留命名卷。浏览器审批和撤销要求已登录工作台。所有公网通信使用 HTTPS，不要对外开放 Docker socket 或服务器命令执行接口。
