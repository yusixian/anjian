# Anjian 自托管

发布前检查、提交与部署证据、失败定位和回滚步骤见 [发布操作手册](releasing.md)。

已在 Dokploy 验证源码镜像构建、运行中容器、主界面 HTTPS 与文档批注/CLI 回复。main 推送已实际触发自动部署。容器重启后文档与评论保留已验证；线上画板独立来源已验证，容器替换后的卷恢复未验证；HTTPS 远程 CLI 已完成公网浏览器与本地 CLI 闭环验收，详见 [交付记录](DELIVERY_GOAL.md)。

## 两个来源

画板预览使用独立 HTTPS origin。独立 HTML 作品通过不含 allow-same-origin 的 iframe 沙箱加载，使用不透明来源。两条路径均限制作品脚本取得主界面的同源权限。

| 服务                                | 容器端口 | 示例域名                      | 配置                   |
| ----------------------------------- | -------- | ----------------------------- | ---------------------- |
| 作品库、文档、评论 API 与 WebSocket | 27319    | `https://anjian.example.com`  | `ANJIAN_PUBLIC_ORIGIN` |
| 画板预览                            | 27329    | `https://preview.example.net` | `ANJIAN_BOARD_ORIGIN`  |

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

## 浏览器登录

首次打开作品库、作品链接或设备授权页时，输入服务器访问密钥登录，不需要先打开终端。可勾选“记住此设备 30 天”，不勾选时只保留浏览器会话 Cookie。登录成功后回到原作品或配对页面，配对仍需单独选择项目并批准。

作品库右上角版本状态面板提供“退出登录”。打开中的作品在返回标签页或每 30 秒检查登录状态；凭据失效时跳回登录页，网络暂时不可用不会被当作退出登录。网页退出仅清除当前浏览器登录，不撤销已授权的 CLI 设备。

访问密钥仍是服务器管理员凭据，不是账号密码。部署时保存的带密钥完整链接继续可用；如果密钥遗失，需由管理员从服务器配置恢复。线上发布与验收范围见 [交付记录](DELIVERY_GOAL.md)。

## 本地 Agent 与远程工作台

远程 CLI 通过设备配对取得可撤销的项目凭证，经 HTTPS 上传作品、读取批注和回复。使用方式见 [远程 CLI](remote-cli.md)。SSH 仅用于服务器运维，不再是产品连接方案。

客户端只传输作品源码和资源，不同步服务器的评论、历史或会话状态。版本冲突会拒绝覆盖；事件监听保留游标，断线后可以续接。宿主 Agent 的自动调度与 CLI 事件输出是两个层次。

新增设备授权记录和事件日志位于服务状态目录，必须和 `/data/project` 一起保留命名卷。浏览器审批和撤销要求已登录工作台。所有公网通信使用 HTTPS，不要对外开放 Docker socket 或服务器命令执行接口。

## GitHub 管理员登录

GitHub 登录为可选配置。首个版本只允许一个指定的 GitHub 用户进入，权限等同于此实例的管理员；没有开放注册、普通成员角色、用户列表或按用户隔离作品。CLI 设备仍按原有项目授权独立管理。不要把其他人的账号配置为 Owner 来代替成员管理。

在 GitHub 的 Settings → Developer settings → OAuth Apps 中创建专用应用：

- Homepage URL：你的案间地址，例如 `https://anjian.cosine.ren`。
- Authorization callback URL：`https://anjian.cosine.ren/auth/github/callback`。
- 不需要仓库权限、邮箱权限或 Device Flow。

在部署平台的私有环境变量中设置以下三项，并重新部署；不要提交 Client Secret 或在聊天中粘贴它：

```dotenv
ANJIAN_GITHUB_CLIENT_ID=<OAuth 应用的 Client ID>
ANJIAN_GITHUB_CLIENT_SECRET=<OAuth 应用的 Client Secret>
ANJIAN_GITHUB_OWNER_ID=<允许登录的 GitHub 数字用户 ID>
```

`ANJIAN_PUBLIC_ORIGIN` 必须对应上述主站地址，生产环境使用 HTTPS。数字用户 ID 可通过 `gh api user --jq .id` 查询；认证比较 ID，不依赖可改名的用户名。三项全部留空时使用原访问密钥登录；只填写部分配置会拒绝启动，避免误以为限制已生效。

配置后登录页提供“使用 GitHub 登录”，访问密钥作为管理员备用入口。GitHub access token 仅用于当次查询身份，不持久化或返回浏览器；浏览器使用独立签名 Cookie。未勾选记住设备时，Cookie 为会话 Cookie，且服务端最多接受 24 小时；勾选时为 30 天。更换服务器主密钥、Owner ID 或 OAuth Client ID 会使旧 GitHub 会话失效。

退出清除当前浏览器 Cookie；不撤销其他浏览器会话、已连接的 WebSocket 或已授权 CLI 设备。设备撤销仍在“设备与 CLI”页面处理。服务重启会让未完成的 OAuth 流程失效，重新点击登录即可；已签发会话在配置未变且未过期时仍有效。

OAuth 使用 state、PKCE 和固定回调地址。取消授权、使用未允许账号及 GitHub 暂不可用时可在登录页重试，有效流程保留原作品或配对地址。协议依据：[GitHub OAuth web application flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。实际发布状态见交付记录。
