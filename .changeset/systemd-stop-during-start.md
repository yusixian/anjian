---
'anjian-workflow': patch
---

<!-- anjian:zh -->

#### 中文

修复 Linux systemd 用户服务在 Hub 刚启动或崩溃后刚重启时接到停止请求，可能显示服务失败的问题。仍可用 `anjian service stop` 停止服务，并用 `anjian service status` 查看状态。

<!-- anjian:en -->

#### English

Fixed a Linux systemd user service failure status when stopping the Hub during startup or crash recovery. Use `anjian service stop` to stop it and `anjian service status` to check its state.

<!-- anjian:end -->
