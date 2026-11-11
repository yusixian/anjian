# 案间发布操作手册

案间从源码构建，由现有 Dokploy Compose 应用部署。交付标识使用完整 Git SHA；不发布 npm 包，不要求语义版本或 tag。本文的检查入口只读取 GitHub，成功仅表示指定提交的 CI 通过。

## 当前机制与缺口

2026-11-11 核对基线 `b74543ce3e11a5076fdf70c8c4c9a7c6361c70ba`：

| 环节     | 仓库证据                                                                                 | 能证明什么 / 边界                                                                                       |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 源码 CI  | [workflow](../.github/workflows/viewer-release-guard.yml)                                | push 与 PR 均运行安装、类型检查和测试；本次新增独立 `release-checks` 脚本测试 job                       |
| 完整构建 | [global setup](../artifacts/test/global-setup.ts)、[构建命令](../artifacts/package.json) | 测试前串行构建 server、CLI、viewer、viewer-lib、runtime；没有上传 Actions 制品或发布镜像                |
| 容器     | [Dockerfile](../Dockerfile)、[Compose](../compose.yaml)                                  | Dokploy 从源码重新构建 `artifacts/dist`，并非复用 CI 产物；Node 22、pnpm 10.28.2，数据在 `/data` 命名卷 |
| 自动部署 | [自托管说明](self-hosting.md#main-自动部署)                                              | 文档记录 main / On Push；不会等待 main CI。本轮未读取 Dokploy 实时配置，历史 Done 不代表本次成功        |
| 版本识别 | [服务入口](../artifacts/src/server/main.ts)、[包配置](../artifacts/package.json)         | 服务使用包版本 `0.1.0`，镜像没有 revision label；相同版本号无法识别不同 SHA                             |
| 回滚     | [Compose](../compose.yaml)、[自托管说明](self-hosting.md)                                | 有持久卷；没有仓库内自动回滚流程，也没有本轮恢复演练证据                                                |

基线 push CI [43019186910](https://github.com/yusixian/anjian/actions/runs/43019186910) 实时查询为 completed/success，head 与上述 SHA 相同。它没有本次新增的 job，不满足新入口的完整检查要求。旧 `scripts/check-viewer-release.sh` 是继承的 npm/tag 检查，不用于案间交付，也不要为通过它创建版本。

## 前置条件与执行入口

使用 Node 22 和已登录、具备仓库 Actions 读取权限的 `gh`。所有命令明确指定 `yusixian/anjian`，避免 fork 被默认解析到上游。完整 SHA 必须来自当前 PR 或远端分支，不用 `main` 字符串代替。

```bash
# PR 合并前：把 <PR> 换成编号，<SHA> 换成查询所得完整 SHA。
gh pr view <PR> --repo yusixian/anjian --json headRefOid,baseRefName,mergeStateStatus,url
node scripts/check-release.mjs <SHA> --pr <PR>

# 合并后重新取得 main SHA；合并提交可能不同于 PR head。
git ls-remote origin refs/heads/main
node scripts/check-release.mjs <MAIN_SHA>

# 本地只测发布入口，不构建应用。
node --test tests/release-checks/*.test.mjs
```

脚本选择该 SHA、该事件在指定 workflow 中最新创建的 run，读取它当前 attempt 的 jobs；要求 workflow、`artifacts` 与 `release-checks` 均 completed/success。PR 模式还在检查前后核对开放状态、仓库及 head。缺少运行、等待中、失败、取消、跳过、job 缺失、API 异常和无效参数均非零退出。API 单次调用上限 60 秒，无自动重试；网络或限流修复后可重跑。输出含 run、attempt 和链接，不访问 Dokploy、凭据文件或应用数据。

该结果是读取时刻的证据，不锁定 PR，也不代替仓库保护、其他必需检查或独立代码审查。合并操作前再次核对 head；旧 SHA 即便检查通过也不能替代当前候选提交。仓库保护的实际配置本轮未验证，执行人需确认后遵守，不能绕过。

## 发布步骤和成功判定

1. 在隔离工作树完成实现、相关测试和独立审查。应用改动按 `artifacts/` 的 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test --maxWorkers 4` 验证；测试初始化会完整构建，不并行启动另一轮构建。
2. 当前 PR head 通过检查入口及所有仓库保护要求后合并。记录 PR head 与最终 main SHA。main On Push 可能已自动部署，不能把后续 main CI 当作自动部署的前置门禁。只改文档也可能触发既有 On Push，不额外手动部署。
3. 对需要上线的变更，调度员读取现有 Dokploy 应用的源码仓库、分支、Compose 路径、触发方式与目标提交，记录部署 ID、状态和时间。没有任务则先查 webhook；失败则看对应任务日志。不要在不明确目标 SHA 时盲目反复触发。
4. 检查运行中容器的镜像 ID、启动时间、退出/重启状态和卷挂载。保存旧镜像 ID 与数据备份位置，避免输出环境变量或带 key 的 URL。Dokploy Done、容器 running、主站 HTTP 200 分别只是部分证据。
5. 建立部署 SHA → 构建日志 → 镜像 ID → 运行容器的对应关系。当前没有内置 SHA 标记；必要时再比较该构建与公网静态资源的完整 SHA-256，记录资源路径和摘要。只匹配一个资源只能证明该资源，不能证明整个服务端版本；无法建立对应关系则版本识别保持待验证，不能用包版本代替。
6. 在主站与隔离预览 origin 验收登录、作品读取、画板/HTML、WebSocket、评论保存及 CLI 回复。使用专用测试作品，保留已有数据。桌面与手机界面改动需浏览器证据；写操作需当前任务授权。卷恢复、真实 S3 等未测项目逐项标注，不能由首页可访问推断成功。

记录应分别包含：PR/合并 SHA、CI run/attempt、部署 ID/目标 SHA、镜像/容器、线上功能结果与未验证项。全部适用证据齐备后才可称为发布完成。本次实现 worker 不部署；实际 PR、合并和生产验证由调度员记录在 Issue #2 实验台账。

## 失败定位与回滚

PR #4 的旧 head `856f824` 曾在系统依赖阶段等待超过 16 分钟，完整测试尚未开始。[运行 43043604956](https://github.com/yusixian/anjian/actions/runs/43043604956) 取消后的日志显示 Ubuntu 软件源 DNS 解析失败；成功基线使用相同的 Ubuntu 26.04 镜像，不能将故障归因于 runner 版本。安装步骤现先检查 ffmpeg/ffprobe；缺失时只做有限重试，索引更新最多 90 秒、安装最多 180 秒，步骤总上限 5 分钟。索引更新失败立即退出，工具版本检查成功后才运行原有完整测试。超时或失败需要诊断后重跑，不能跳过媒体测试。

main 的 #3/#5 已合入本分支；发布时还需核验新增的 `website` job 与镜像内 `website/out` 产物，上方旧基线审计不替代这项检查。

后续 head `eea40c3` 的 [PR CI](https://github.com/yusixian/anjian/actions/runs/43048370951) 在 90 秒以退出码 124 终止索引更新，证明等待已受限，但 DNS 故障尚未解决、应用测试未执行。CI 临时 runner 的 Ubuntu mirror list 改用 [Linux Kernel Archives 镜像](https://mirrors.kernel.org/)，保留发行版签名校验和上述时间限制，不修改生产服务器的软件源。只有新 head 的安装和完整测试实际通过，才算修复验证完成。

| 失败点                 | 下一步                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| 没有 CI                | 核对仓库、SHA、事件与 workflow 触发；等待运行出现，不能将空列表当成功          |
| CI 失败或取消          | 打开输出的 run/attempt，保留失败步骤；修复后检查新 SHA，重跑则核对新的 attempt |
| CI 成功但缺少 job      | 核对工作流版本；旧提交没有新增 job 会被拒绝，不降级跳过                        |
| 部署无任务或失败       | 查现有应用 webhook 与任务日志，确认来源及目标 SHA，再决定是否重试              |
| 容器启动或线上功能失败 | 保留日志、部署 ID 与镜像 ID；停止继续发布，判断是否需要回退                    |

回滚由拥有生产操作授权的执行人完成：

1. 先确认最近一次**线上验收通过**的 SHA、镜像是否仍存在、配置是否兼容及数据备份是否可用；CI 成功本身不是已知良好版本。暂停新的发布操作，协调 main 自动部署，避免旧任务在新任务后覆盖生产。
2. 优先通过现有 Dokploy 界面确认是否支持选定历史部署或固定镜像；本轮未核验该能力，不能假定“重新部署”会使用旧 SHA。如果只能跟随 main，创建恢复已知良好代码的 revert PR，经检查与审查后合并，不强推 main。
3. 保留 `/data` 卷、访问密钥和 OAuth 配置。不运行 `docker compose down -v`，不删除卷，不把代码回退等同于数据恢复；若旧代码不兼容当前数据，停止并另行制定恢复方案，不自动执行迁移或覆盖。
4. 对回退目标重新记录 CI、部署、容器、版本对应及线上验收结果。未实际演练恢复时明确写“回滚入口已说明，恢复未验证”。

## Magpie 参考取舍

只读参考 [Magpie release.yml（固定提交 f5124ea）](https://github.com/yetone/magpie/blob/f5124ea1792e1e82e627d5ee51b5d6c41fe8d9f2/.github/workflows/release.yml)。没有对该仓库执行写操作。

| 参考做法                                                         | 案间取舍与原因                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| dispatch 后等待 16 个制品，再复制并复查数量                      | 采用“触发不等于完成”；案间没有安装包清单，不照搬 16 这个数量。完整构建由测试初始化执行；容器与线上完整性另验         |
| 对限流设置期限并重试，其他错误立即失败                           | 采用有界失败；只读入口单次超时并非零退出，由执行人定位后重跑，不引入长时间自动重试                                   |
| 重跑同一 tag 更新已有发布，旧版不抢 Latest，复制后再纠正并发结果 | 采用明确目标 SHA、当前 attempt 和上线前核对目标；旧 SHA 检查不自动触发部署。人工串行发布，保留自动部署并发的核验责任 |
| 跨仓库构建、签名、公证、镜像 release 和 Latest 标记              | 不采用；案间没有安装包发布与自动更新需求，不新增密钥或发布平台                                                       |
| 缺中文说明单独记录问题                                           | 采用失败可追踪原则，记录 Issue/PR、run、部署 ID 和待验证项；不自动发消息或另建 Issue                                 |

本次已遇到的具体失败：沙箱内首次 `gh issue view` 网络连接失败，获准网络读取后成功；这不是 Issue 不存在。以后必须把读取失败与空结果分开。新增入口也会拒绝已有成功但缺少新 job 的历史 CI，防止用旧绿灯代替新流程验收。
