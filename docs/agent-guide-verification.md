# Agent 远程操作指引验证

## 场景与验收条件

使用不继承主会话历史的 Agent，只提供指引入口；不允许修改远端或读取凭证正文。

1. 已有自托管实例、已授权包装器、新会话未知入口：从工作区指引定位 CLI 和绑定项目，先检查 remote status。
2. 文档已有网页批注且本地可能有改动：读取完整批注，安全拉取建立版本基线，保留本地修改，编辑后 push、check，再回复线程。
3. 新机器未登录：设备 login、管理员浏览器批准、link；区分管理员登录与设备配对，不索取聊天中的密钥。
4. 冲突/撤销/过期游标：不伪造 --force；明确保留本地内容及重新授权、读取当前批注再重置游标的恢复流程。
5. watch 只输出事件，不声称自动唤醒宿主；凭证不写入项目或公开指引。

## 检查清单

- [x] 编写场景与验收条件。
- [x] 旧指引基线及具体失败证据。
- [x] 最小更新，覆盖入口、远程步骤和失败恢复。
- [x] 新上下文 Agent 复测并修正缺口。
- [x] 命令帮助及已授权入口只读验证。
- [x] 检查链接、凭证边界和改动范围。
- [ ] 提交与推送（执行结果由交付回复记录）。

这是操作参考指引测试，不是纪律型压力测试；措辞微测试的五次重复不适用。测试结论不能扩展为所有宿主已安装或通知调度已接通。

## RED：旧指引结果

独立 Agent `agent_skill_baseline` 仅阅读原 AGENTS.md、Skill 和 document.md 后，给出的流程为 `start → comment list → 编辑 → check → reply/resolve`，遗漏 remote status、pull、push。

原文证据：“Their edits and yours merge live” 暗示文件实时同步；“Every artifacts command goes through ... app/anjian.cjs” 未说明已有绑定包装器。Agent 明确报告“没有定义远端状态查询、pull、push 或上传命令”，也找不到 watch 的唤醒边界、凭证位置和新机器授权步骤。

修改范围：Skill 增加远程模式分流及 bundled remote.md；三种作品参考明确远程规则优先；仓库 AGENTS.md 与安装文档提供发现入口；当前工作区另有不含秘密的本机 AGENTS.md，指向已有包装器，未修改全局 Agent 配置。

## 主代理命令核验

- 本地构建 CLI 的 push、comment reply、remote --help 与指引参数一致。
- 按工作区入口实际执行 `bash .anjian-e2e/anjian remote status --json` 成功，返回目标 origin 与 projectId。
- `comment list --artifact document/e2e-remote --all --json` 读取到线上已有批注及 Agent 回复；未执行写操作。
- Skill 与安装文档的本地链接均存在，frontmatter 431 字符，git diff --check 通过。新文档只引用配置路径，不包含 token、访问 key 或带 key 的真实 URL。

## GREEN 与修订

新上下文 Agent `agent_skill_verify` 从工作区 AGENTS.md 正确找到了本机包装器、固定作品项目及 doc.xml；给出了 status → 全量批注 → pull → 局部编辑 → push → check → reply 的顺序，并正确说明本地改动备份与合并、冲突、401/403、配对与管理员登录的区别、watch 的事件边界以及凭证保密。CLI 帮助核验通过；联网只读结果由主代理单独核对。

复测发现原 document.md/artboard.md 的自动 resolve 说明与远程参考不一致，已统一为请求或明确授权后 resolve；另将 document.md 的旧服务版本恢复步骤区分本地重启与远程部署升级。

定向复测确认上述 resolve 与旧版本恢复歧义已消除。此次仅改操作指引，无应用运行代码变更，因此未重复全量应用测试。
