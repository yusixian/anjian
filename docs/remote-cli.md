# 用本地 CLI 连接自己的案间

本地 Agent 通过 HTTPS 操作服务器上的作品与批注，不需要 SSH。凭证仅授权所选项目，不允许执行服务器命令。

## 安装与首次连接

先按 [源码安装](install.md) 构建 CLI。下文的 `anjian` 对应本仓库 `artifacts/bin/anjian.cjs`；未安装到 PATH 时，可用 `node /你的路径/artifacts/dist/cli.cjs` 替代。

```bash
anjian login https://anjian.cosine.ren --name "我的电脑"
```

CLI 打开浏览器并显示配对码。在已登录案间的浏览器里核对设备名称与配对码，勾选允许访问的项目，再点击「批准此设备」。没有登录时，先用服务器启动输出中的完整访问链接打开工作台；不要把该链接或密钥发给他人。

配对码 10 分钟有效，设备凭证 90 天有效。终端不能打开浏览器时加 `--no-open`，手动打开输出的地址。在工作台侧栏的「设备与 CLI」中可以查看和撤销设备。撤销立即阻止后续请求；正在进行的操作可能已经完成。

在本地项目目录绑定远程项目：

```bash
anjian link
anjian remote status
```

只有一个可访问项目时自动选择；多个项目时先列出选择，再执行 `anjian link --project <项目ID>`。多实例使用 `--server https://你的实例`。项目 ID 不是服务器路径。

## 上传、拉取与冲突

作品仍在本地 `.anjian/artifacts/<类型>/<名称>/` 中编写：

```bash
anjian push --artifact document/plan
anjian push --artifact artboard/design
anjian push --artifact html/demo
anjian check --artifact document/plan
```

上传后返回网页地址。服务器可能给文档补齐块 ID，CLI 会在本地文件没有同时改变的情况下写回规范化内容。

只上传所选作品源码与资源；评论、历史、CRDT 状态、点目录和密钥不参与传输。不支持符号链接。单次最多 1,000 个文件、32 MiB 解码后的内容。

服务器已有同名作品时，必须先拉取建立版本基线：

```bash
anjian pull --artifact document/plan
```

远端在上次同步之后变化，`push` 返回冲突。此时不要覆盖：先拉取并比较。若本地也有改动，普通 `pull` 拒绝覆盖；可以显式使用 `--backup-local` 将本地源码保存为受限权限的备份清单，再拉取远端。CLI 输出备份位置；合并自己需要保留的修改后重新上传。

同步以显式命令为准，不自动合并两个不同版本，也不后台镜像整个目录。避免在同一作品上传/拉取时让另一个编辑器执行保存；CLI 会检查已观察到的并发修改，但无法锁住不遵守锁协议的外部程序。

## 批注和 Agent

```bash
anjian comment list --artifact document/plan --all --json
anjian comment reply --artifact document/plan --thread <线程ID> --text "已修改"
anjian comment resolve --artifact document/plan --thread <线程ID>
anjian watch --json
```

`watch` 输出事件通知，Agent 再调用 `comment list` 获取内容，或 `pull` 获取作品。事件包含稳定 ID，可用于去重。事件输出后 CLI 才保存游标；进程在中间退出时可能重复输出，消费方应按 ID 去重。输出事件不等于宿主 Agent 已自动处理：Lody/其他宿主的任务调度需要单独接入。

断网和服务暂时不可用时监听自动退避重连。服务器保留每项目最近 1,000 条事件，并限制日志大小为 16 MiB；超过保留窗口返回明确错误。此时读取当前批注后执行 `anjian watch --reset --json`，不能假设旧事件已经消费。服务器重启会输出 `resync` 提醒，需读取当前完整状态。

单次消费可使用 `watch --once --json`。第一次没有游标时建立当前位置，不自动重放所有历史批注；需要历史时用 `comment list --all`。

## 凭证与解绑

```bash
anjian logout https://anjian.cosine.ren
anjian unlink
```

`logout` 撤销服务器凭证；`unlink` 仅移除当前目录的绑定。凭证及绑定保存在用户目录 `~/.anjian/client/`，不写入项目仓库；目录权限 0700、文件权限 0600。测试或多套独立配置可通过 `ANJIAN_CLIENT_HOME` 指定目录。

公网实例要求 HTTPS；本机调试允许 loopback HTTP。CLI 不跟随凭证请求的重定向。配对申请有速率和数量上限；反向代理后的请求可能共享限流窗口，遇到 429 请等待后重试。不要通过关闭认证解决连接问题。

## 当前验证边界

实现中的版本以 [交付记录](DELIVERY_GOAL.md) 为准。自动化测试、实际浏览器授权、本地端到端和生产部署分别验收；新增接口上线前，已部署的旧版本不支持上述命令。
