# Issue #6：CLI 内置 Skill 验证

本次把 `skills/artifacts/` 的主文档和 9 个参考资源嵌入 CLI，提供 `skills list/get`、帮助发现链路和未绑定提示，并修复源码启动器读取帮助时写入批注订阅的问题。行为评估验证的是 Agent 的接入决策，不是生产设备配对。

## 行为对照结果

所有基线均在修改 Skill 前运行。每次使用独立 fresh-context Agent，不继承实现会话；相同提示重复 5 次，分别读取旧版和新版完整 Skill。旧版是“没有新增指引”的对照，并非完全不提供任何 Skill。[场景与原始提示](scenarios.md)、[修改前快照](before/SKILL.md)、[修改后快照](after/SKILL.md)均保留。

| 判定项                             | 旧版 5 次 | 新版 5 次 |
| ---------------------------------- | --------- | --------- |
| 通过 CLI 读取主 Skill 和 remote.md | 0/5       | 5/5       |
| 要求管理员浏览器身份               | 4/5       | 0/5       |
| 保持配对进程，成功后 link 和回读   | 5/5       | 5/5       |
| 使用不存在的 scope 参数            | 0/5       | 0/5       |
| 把未上传状态描述成已同步           | 0/5       | 0/5       |

逐份人工阅读 [baseline-1](raw/baseline-1.md)、[2](raw/baseline-2.md)、[3](raw/baseline-3.md)、[4](raw/baseline-4.md)、[5](raw/baseline-5.md) 和 [after-1](raw/after-1.md)、[2](raw/after-2.md)、[3](raw/after-3.md)、[4](raw/after-4.md)、[5](raw/after-5.md)。例如旧版第 1 次明确说“原指引没有提供从独立 CLI 导出或安装 Skill 的发现命令”，第 4 次要求“已登录管理员账号的浏览器”；新版各次都列出 `skills get artifacts` 与 `--reference remote.md`，并使用用户账号批准。新版提到 `--scope all` 和管理员角色均为否定说明，未作为执行命令或授权要求计入。

失败类型是缺少可执行发现路径和错误的授权前提，因此采用正向步骤与条件分支：有绑定则复用，缺授权则发起配对，未知 origin 或项目歧义才询问。没有增加泛化的禁止清单或改变其他作品工作流。

额外的[压力基线](raw/pressure-before.md)和[压力复测](raw/pressure-after.md)结合两小时投入、五分钟演示期限和用户催促，覆盖有效绑定、多项目歧义、未知 origin。两版都保留有效绑定并等待必要信息；新版明确在账号可授予范围选择全部所需项目，也通过 CLI 获取指引。复测 B 从发起 login 开始叙述，未明确区分“已经 pending 的现有进程”与首次启动，属于该样本的表述局限；五次微对照均明确等待现有进程，不把 pending 报成成功。

这些是实际 Agent 调用产生的决策输出，未执行场景中的远程命令。它们支持指引改善了当前样本的发现与授权表述，不能证明所有宿主都会自动加载 Skill，不能替代真实浏览器批准或生产同步验证。没有进行生产配对、全局安装或部署。

## 实现与离线验证

自动化测试先失败再修改：两种入口缺少 Skill 命令、启动器 help 写入 `.anjian`、未绑定错误没有下一步；新增测试现覆盖完整资源读取、显式 JSON、非法路径拒绝和零文件副作用。原始测试日志与打包产物保存在本机 `/tmp/anjian-issue6-evidence/`，不纳入源码包。

- `pnpm install --frozen-lockfile`：成功，锁文件未变。
- 定向测试：36 项通过。
- `pnpm typecheck`：通过；最终串行 `pnpm build` 通过。构建仍输出 chunk 体积提示，测试环境输出颜色变量和 localstorage 提示，未将这些提示描述为无警告。
- 全量测试：最终 224 个文件、1815 项全部通过（112.21 秒）；第一次受限运行因本地网络 EPERM 中止，放开本地测试网络后发现新增集成测试超过默认 5 秒，已将两项多进程测试超时设为 30 秒。
- `pnpm pack --pack-destination /tmp/anjian-issue6-evidence`：生成 `anjian-0.1.0.tgz`，未发布。
- `verify-package.mjs`：分别验证直接构建 CLI、源码启动器、解包后的 `bin/anjian.cjs`。每种入口读取全部 10 份资源，文本与当前源码全文一致（仅替换命令入口并加阅读头）；Markdown 与 JSON content 一致。未知资源、穿越及绝对路径失败。
- 打包验证的每个项目都为空目录，环境独立设置 HOME/client/server/runtime/config，不继承凭据。预加载拦截写文件、网络连接及非 CLI 子进程；三种入口均未触发拦截，也未生成状态文件。包内不包含 Skill 源码目录，读取依靠内嵌文本。

复核脚本已随报告保留：[verify-package.mjs](verify-package.mjs)。在仓库根目录先执行 `mkdir -p /tmp/anjian-issue6-evidence`，再在 `artifacts/` 执行 `pnpm build` 和 `pnpm pack --pack-destination /tmp/anjian-issue6-evidence`；回到仓库根目录执行 `node docs/evidence/issue-6/verify-package.mjs "$PWD"`。产物和结果分别见同目录 `anjian-0.1.0.tgz`、`package-verification.json`；临时项目路径写在 JSON 中。此验证只覆盖读取入口，不代表服务器部署或全局 CLI 安装已完成。

## 流程核对

- RED：已保存场景、5 次无新增指引对照、逐字输出和失败分类。
- GREEN：保持原名称及触发描述；修改发现和授权条件；5 次同条件微对照及压力复测。
- REFACTOR：保留原始样本中的不确定性，不把否定提及误判为使用；未发现需要扩展协议或重绑的依据。
- 质量：引用仍来自唯一源 `skills/artifacts/`；运行时白名单拒绝任意文件路径；未改其他作品规则。
- 交付：由调度线程负责提交、推送、PR 和独立复核；本实现工作树未进行这些操作。

最终产物 SHA-256：CLI `54a4df73d29f214355fb28f9de9c5bcc8b7f1ba20053d4911c5012e7a4ea6891`；打包文件 `8e48b73e8fbd43f0f46942043c78379f3791f84307c0688839272fc41a72e1db`。最终离线复核仍为三种入口各 10 份资源、零拦截或文件副作用。
