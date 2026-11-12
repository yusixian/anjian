# 统一版本与可验证发布

Changesets 只计算私有根包 `anjian-workflow` 的版本。应用、CLI、内置 Skill 所属 CLI 和 `.version-bump.json` 中的插件清单同步同一版本；三个独立锁文件保留。根与应用始终 `private: true`，流程不执行 npm publish。

## 提交变更与发布 PR

1. 功能或修复附一个包含同一事实的中文 / English changeset，格式见 `.changeset/README.md`。当前初始 changeset 包含版本流程、CLI 内置指引及部署边界，不补造继承历史。
2. `Version PR` workflow 在 main 更新后使用固定 Changesets Action v2.1.2 自动维护 `changeset-release/main` 发布分支与同一个 PR。`pnpm release:version` 消耗待发 changeset，生成 Changelog，再按根包结果同步全部声明清单；无待发变更则保持不变。旧 bump 脚本只支持检查或同步。
3. 机器人明确对发布分支触发 `Anjian checks` 的 `workflow_dispatch`，传入实际 head SHA。检查入口拒绝 SHA 漂移。复核时执行 `node scripts/check-release.mjs <完整 head SHA> --pr-dispatch <PR 编号>`；没有实际成功运行不能视为通过。
4. GitHub 当前规则允许 GITHUB_TOKEN 创建的 PR 产生待批准的 PR workflow；push 不自动触发其他 workflow，而 workflow_dispatch 可以。这里使用显式 dispatch，仍需核对首次实际运行。不要将“已派发”或旧 head 的成功视为当前 PR 成功。
5. 发布 PR 合并后的 main push 必须重新通过 CI；PR 的检查不能替代合并提交检查。

只需仓库自动提供的 `GITHUB_TOKEN`，无需 npm token、额外 PAT 或部署 secret。仓库设置须允许 GitHub Actions 创建 PR。Version PR 最小权限为 contents/write、pull-requests/write、actions/write；正式 Release 为 contents/write、actions/read。CI 使用 contents/read。分支保护与审批策略由维护者配置，不由脚本改动。

## GitHub Release 与重试

`Verified GitHub Release` 仅响应 main 的成功 push 检查。它检出该次检查的完整 SHA，只处理相对第一父提交引入产品新版本的提交；普通功能提交不会发版。发布前再次检查该 SHA 的最新 CI attempt、必需任务、版本清单、双语说明、干净工作树及 main 祖先关系。

Tag `v<版本>` 是指向此 SHA 的轻量 tag。相同版本、相同 SHA 的重试复用已有 tag 和 Release；中断在 tag 创建后可继续创建 Release。不同 SHA、注解 tag、已有不一致说明或非正式 Release 均拒绝覆盖。CI 失败或未知构建不创建 tag。修复问题后重新运行失败的发布 workflow；不要移动 tag，已发布版本的修复需要新的 changeset。

创建 Release 只证明 GitHub 记录，**不代表生产部署成功**。发布输出明确记录部署未验证。首轮真实发布的 PR、SHA、CI、Release、部署与线上验证由维护者接续记录。

## 构建身份与自动部署

所有本地入口从同一个构建函数读取产品版本、Git SHA、工作树状态以及 Changelog 中精确版本的双语说明。应用状态面板分别显示当前界面与服务器身份，说明属于界面本构建；CLI 的 `version --json` 显示 CLI 自己的身份，旧 `--version` 保持纯版本号输出。源码导出没有身份时显示 unknown；脏构建明确显示本地改动，不声称是正式版本。

容器上下文通常排除 `.git`。需要保留源码身份时，可在任意干净提交的检出中运行：

```sh
node scripts/release/build-info.mjs --export
docker build -t "anjian:$(node -p "require('./package.json').version")-$(git rev-parse --short=12 HEAD)" .
```

身份导出仅要求干净源码，不依赖 CI、tag 或 GitHub Release，也不触发部署。普通功能提交可沿用当前产品版本，以 SHA 区分构建；版本号本身不证明该构建是正式 Release。

导出文件 `.anjian-build.json` 被 Git 忽略，只应由该命令生成并随同 Docker build context 传入。它记录所有受 Git 管理文件的哈希；容器构建逐项校验，源码变化时拒绝借用旧身份。没有导出文件仍可构建，但身份为 unknown，不能用于声称可追溯的正式部署。不要手填 SHA 或复制另一版本的导出文件。`exported` 说明身份来自已校验源码导出，不代表线上健康已验证。

保留现有 main On Push 自动部署，不修改 Dokploy 配置，也不要求管理地址或凭据作为合并、发版前置。自动部署可能早于 main CI 或 GitHub Release 完成；Changesets 和发布检查只管理版本与 GitHub Release，不控制部署。容器没有 Git 或导出身份时如实显示 unknown，不推测线上 SHA。

部署后同时核对容器镜像 digest、服务端 `/api/status` 的 `build`、界面构建身份与实际可用性。CLI 在外部干净项目运行 `version --json` 和 `skills list --json` 单独验证，服务器升级不会自动升级 CLI。失败时保留日志，恢复上一已知健康镜像 digest 和原部署配置；不删除卷或数据。数据库或存储兼容性应在回滚前单独确认。

## 本地验证与边界

- `pnpm test:release`：清单同步、语言来源、构建身份、CI 失败门禁、tag/Release 中断重试和冲突。
- `pnpm --dir artifacts typecheck` 与 `pnpm --dir artifacts test --maxWorkers 4`：应用和 CLI 集成。测试 setup 会串行构建完整应用，不同时启动另一个完整构建。
- 临时副本实际执行 `pnpm install --frozen-lockfile --ignore-scripts` 和两次 `pnpm release:version`；不要在待提交的实现工作树演练正式升版。
- 浏览器验证中文 / English × 桌面 / 手机、长英文、缺失翻译回退及离线说明；图片留临时目录交给 PR 上传者。

本地测试不等于 GitHub workflow 已运行，Release 不等于已部署。首次机器人发布 PR、远端 CI 和 tag/Release 必须记录实际证据。线上访问、构建身份及容器验证分别记录，缺少容器信息不阻止版本能力交付。

## 固定版资料

- [Changesets CLI 3.0.3 配置](https://github.com/changesets/changesets/blob/%40changesets/cli%403.0.3/docs/config-file-options.md)：显式启用 privatePackages.version，禁用 tag。
- [Action v2.1.2 API](https://github.com/changesets/action/blob/v2.1.2/action.yml)：使用 github-token、version-script，SHA 固定为 ae32849d5ba541f9ae29e40e22a623bc13562f51，不使用 v1 输入。
- [GitHub workflow 触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)：实施时核对，首次运行仍须真实验收。
