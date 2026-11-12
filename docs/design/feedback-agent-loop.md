# 网页反馈到 Agent 修改与验收

日期：2026-11-12。状态：已实现，待远端 CI 与发布；接口调整须同步本文与调用端。需求：Issue #37。基线：30ca781a7fd98dd09ce3263ddae7f0c09133d614。

## 目标与边界

在已授权项目为作品连接一个 Lody 会话后，用户明确提交反馈，案间持久保存任务；Lody 只读条件发现待办并恢复该会话，Agent 原子认领，读取完整批注和当前修订，安全修改上传并回复，用户在原作品查看结果并验收。首次支持文档和画板已有批注；HTML 没有原生批注接口时不伪造支持。一个项目可含多个作品，范围显式选择，不自动接管历史未解决反馈。

不新增外部服务、服务器执行命令、公开分享评论权限、多宿主调度平台。不改变手工 CLI、本地 watcher 和既有项目设备权限。不把任务完成等同用户接受，不自动 resolve 所有批注。

## 现状与复用

- `artifacts/src/server/remote-api.ts:41` 使用已批准设备和项目范围，拒绝浏览器 Origin；`:104` 在项目变更锁内上传并再次验证撤权。
- `artifacts/src/server/remote-transfer.ts:280` 比较 baseRevision；已有安全落盘、暂存与配额机制不能绕开。
- `artifacts/src/server/routes/comments.ts:59` 提供同源网页批注写入；现有线程/消息ID与锚点是反馈事实源。
- `skills/artifacts/app/codex-comment-watch.cjs:125` 已有本地Codex queue桥，远程watch只输出事件并推进cursor，不能作为本需求接收回执。
- Lody官方automations支持只读ctx.exec、持久一次性条件和固定Session续接；matched不等于执行，Stop不被覆盖。无需假设外部Lody CLI。

## 选择与代价

采用案间持久任务 + Lody会话内Skill适配。仅轮询事件无法可靠显示接收与结果；外部常驻连接器增加未验证宿主API及部署成本；服务器执行Agent扩大权限，均不采用。代价是会话Stop/归档后不能承诺自动恢复，作品必须提供明确恢复操作，任务本身不丢失。

## 数据与不变式

存储位于服务端home下独立feedback目录，版本化JSON原子替换，拒绝损坏/符号链接、不静默清空。复用项目写入串行化；重启重读持久状态，不依赖进程内Map。不得将任务文件作为作品资源上传或公开分享。

Connection：id、project、artifact范围、host=lody、session标识、displayName、绑定deviceId、generation、enabled、最近确认时间。会话标识私有，网页显示友好名，不暴露宿主令牌。设备撤权每次操作重新校验。connect由已绑定CLI提交，网页明确显示连接与暂停/恢复状态。

Task：id、connectionId、artifact、submissionKey、feedback消息边界（threadId/messageId列表与提交时快照摘要）、state、attempt、claimOwner、claimToken哈希、leaseUntil、inputRevision、outputRevision、replyIds、errorCode、时间。

状态：queued→running→awaiting_review→accepted；运行失败进入needs_attention；queued可取消。claim成功才可称Agent已接收/处理，不以automation匹配或监听心跳作证据。连接可用性与任务状态分开；无法判断Stop/归档/离线具体原因时显示最近确认/需恢复，不捏造宿主状态。

同作品只能一个running任务；新提交形成新的批次queued，不能改变当前输入边界。重复submissionKey返回同任务，但不同payload报409。批注正文只是输入，不能替代执行授权。

lease默认5分钟，可续；过期仅标需恢复，不自动允许第二执行者覆盖。显式恢复认领递增attempt并使旧token失效。所有任务写入/上传/回复/完成都在同一项目锁下验证connection generation、device、task、attempt/token和有效期；旧代次返回409 stale_claim。普通手工写入仍用原权限及revision保护；不伪称能阻止恶意持有同权限者绕开任务契约。

## 接口边界

以下为新增接口；完整请求字段以共享类型、服务端校验和 CLI help 为准。

远程设备入口 `/api/remote/projects/:project/feedback`：

- GET `/connections`，POST `/connections`（host/session/displayName/artifacts、幂等key），POST `/connections/:id/pause|resume`。
- GET `/tasks?connectionId=&state=`：只读持久待办/未完成任务，不消费cursor；返回精简任务身份，完整输入通过任务详情读取。
- GET `/tasks/:id`：完整输入边界、状态、相关作品/线程引用。
- POST `/tasks/:id/claim`：connectionId、claimant、requestId；原子认领并返回attempt、leaseUntil、inputRevision（不返回令牌）。重复同requestId幂等，不发新代次。
- POST `/tasks/:id/renew|recover|fail`：执行身份；recover须显式且校验过期/needs_attention并递增代次。
- POST `/tasks/:id/result`：任务执行身份、upload操作ID、baseRevision/files、逐线程reply文本。复用现有上传、检查和评论能力；结果身份按task/attempt/opId幂等。持久记录上传阶段、预期/实际revision与replyIds，崩溃恢复先对账再补余下步骤，不盲目重做修改。结果revision和回复均可回读后才awaiting_review。实现可拆prepare/upload/reply/complete端点，但写入必须fenced且恢复事实完整。

网页入口经现有同源及项目访问校验，以原作品地址解析真实project/artifact，不接受任意文件路径：GET连接/任务，POST明确submit（选中未解决线程及当前消息版本、submissionKey），POST accept/cancel/retry/pause。accept只允许awaiting_review且用户操作；继续反馈创建新批次。不存在/越权项目不泄漏任务详情。

CLI `remote feedback`子命令对应connect/status/pending/show/claim/renew/recover/result/fail/pause/resume，沿用已有--project-dir和client配置；help与读取无副作用。claim凭据不写公开日志，不嵌入automation程序。result使用显式文件/manifest输入，保留现有pull/push命令，不虚构scope。

## Lody适配与恢复

Skill注册只读pending条件，通过已绑定wrapper的绝对入口与已有私有配置查询。条件不claim、不consume watch cursor、不写心跳，遇未授权返回诊断续接而非换凭据。返回resumeText包含任务ID和安全读取指引；不将批注正文拼接为可执行shell。

恢复会话先核对已有任务/claim/result与automation list：复用同连接active等待，避免重复注册。处理一个任务后对账下一批并注册下一次等待；首次连接也需处理显式选定历史范围。matched后会话没运行时任务仍queued。Stop不自动清除；归档/失联后在网页提示未确认/恢复连接，可明确绑定新测试会话代次，旧执行失效。不能依赖finally一定执行；下次人工恢复或受支持会话启动入口须先对账/补注册。

注册失败、daemon失联、claim中断、上传后未reply、reply后未complete分别保留实际阶段。重试同operationId；无可靠阶段证据时needs_attention，不能声称成功。原事件journal过期不影响任务列表对账。

## 界面

复用作品批注区域和现有组件/StyleX，中英。明确“提交给Agent”而非每次输入自动启动；展示目标、待接收/处理中/需处理/待验收及查看结果/重试/暂停。任务结果链接到本作品revision与原线程回复。未连接给一次连接指引；不新增独立管理后台。手机使用dvh和既有抽屉，保留手工批注入口。画板选择轮次复用提交边界，避免一次反馈被两个机制重复处理。

## 验证、发布与回退

优先单元/接口：重复提交/claim、重启持久恢复、同作品竞争、旧token失效、撤权、跨项目访问、上传后崩溃、reply幂等、运行中新消息、用户accept边界、损坏存储及配额。真实独立Lody测试会话+临时作品完成浏览器提交→真实续接→认领→修改上传/回复→用户验收；Stop/暂停恢复用测试会话，禁止唤醒用户工作会话。mock与真实宿主证据分开。

Skill先记录无新指引的决策基线，再对同场景复测，保存原始输入/输出；涵盖重复唤醒、上传已成功、撤权和运行中新反馈。UI用pr-visual真实截图，桌面手机中英仅覆盖受影响路径；全量构建串行。

按显式连接启用；关闭连接停止新认领，不删任务/评论/作品。旧版本忽略新增独立存储，回退不自动回滚已上传作品。正式发布沿用Changesets双语说明及现有CI，不新增Dokploy门禁。未知宿主生命周期能力须真实实验确认，不用文档声明替代验收。

## 所有权与交付切分

调度拥有本文、整合分支、架构/界面判断、真实宿主实验、最终复核与Git交付。第一worker拥有任务存储/服务器路由/CLI与针对性测试，不碰viewer或Skill；稳定API后分配UI/Skill实现，避免相互争改。源码文件边界以派发简报为准。发现事务或授权约束冲突先报告并继续独立部分，不擅自削弱fencing/幂等。

## 契约澄清：认领响应丢失、暂停和锁

认领令牌由CLI在发送前用CSPRNG生成32字节，和requestId一起写入现有私有client状态（0600、原子落盘、拒绝符号链接），持久化失败不发请求。claim请求携带token，服务器只保存其哈希，常量时间校验。相同requestId必须同device/connection/task/claimant/token哈希，返回同attempt及当前状态，不能重新认领或延长租约；不同token或payload返回409。响应丢失后CLI读取原记录重试即可恢复，无需服务端保存明文令牌。输出/日志不显示token，后续命令从该私有记录读取；本地凭据丢失不得以requestId换取token，须按显式recover流程生成新请求及令牌，使旧代次失效。恢复请求同样先持久化且幂等。过期/取消后重放返回现状或明确错误，不复活认领。

暂停连接（pause）只阻止新claim/recover，不改generation；既有running任务可renew/result，UI明确“暂停新任务，当前任务继续”。resume仅恢复新认领，不改变旧代次。取消运行任务为独立显式动作：在项目锁内使该task代次/token失效，后续renew/result拒绝；已上传作品/回复不回滚。重新绑定会话或设备（rebind）必须显式且递增connection generation，使旧运行代次失效并进入needs_attention，用户在新连接明确恢复；不得在pause或resume中悄悄完成rebind。撤权遵循现有授权检查，不能续传。

项目锁只在路由/服务编排最外层取得一次。result在该临界区调用不再次加锁的内部上传/评论原语，禁止通过再次进入已加锁HTTP入口形成嵌套死锁。异步准备后、最终写入前再次校验claim/device/generation。恢复阶段也使用同一边界。

追加测试：服务端claim持久成功后主动断响应，CLI以原私有记录重试恢复相同attempt；不同token重放拒绝；重放不续租；pause仍允许当前result但拒绝新claim；resume不重置代次；cancel/rebind后旧result拒绝；result集成限时完成证明无嵌套锁等待。已读取独立用户验收场景，沿完整网页反馈到结果验证，不增加等价矩阵。

## 宿主只读条件：可执行任务与人工恢复

`pending` 是诊断列表，不是可执行队列。一次性 automation 只在已绑定连接 enabled 且 authorized、连接代次符合注册配置，并且服务器确认任务当前可认领时匹配。正常候选是 queued；按 createdAt/id 稳定选择一个。同作品存在 running（含过期）或 needs_attention 时，后续 queued 不可认领；不同作品互不阻塞。服务器需提供窄的可认领/阻塞事实，复用 claim 规则，不向设备暴露另一设备任务内容。条件读取与认领之间仍可能竞争，最终以原子 claim 为准。

健康 running 不唤醒新执行；过期 running 或 needs_attention 不自动 recover。网页明确重试须形成持久恢复请求标识，与失败状态/updatedAt区分；成功 recover 消耗该请求，同请求的失响应重放按原claim幂等处理，不能再次增加attempt。恢复执行失败后保留需处理，须有新的用户恢复请求。暂停不产生诊断唤醒，待 resume 后重新评估；没有可执行任务时继续原等待，不不断匹配并重注册。

授权失效、配置代次改变或需人工处理只允许一次诊断续接；续接记录已观察的诊断身份后不能原样重新注册立即命中的条件。可选择停止该连接等待并明确要求恢复，不能自动换凭据。不得因条件错误或HTTP超时写任务、消费cursor或清除Stop。原会话Stop/归档时网页重试仅保存请求，不保证唤醒，用户须恢复会话或显式rebind。

真实宿主实验补充：暂停连接且queued存在时连续多次条件求值无续接；恢复连接后一次续接。前批失败needs_attention、后批queued时无循环唤醒；网页明确重试后只恢复前批一次，成功后后批才能继续；再次失败须新的用户操作。记录条件求值、实际宿主持久续接、claim attempt和作品结果四类证据，不能用本地函数测试替代真实宿主结果。

## 作品内操作层级

已连接时直接显示选择批注与提交给Agent，连接管理及暂停放在次级展开区。当前任务用反馈摘要、时间、目标友好名区分；原始任务ID、修订哈希和错误码仅放诊断详情。待接收、处理中、待验收保持可见，已验收和取消历史默认收起。结果入口让用户阅读实际修改与原线程回复，再决定验收。

未连接时提供可复制给当前Agent的接入说明，含当前作品范围并引导发现已配置CLI和内置Skill，不假定全局安装或要求用户理解协议。浏览器验收实际走复制指引、选择提交、结果验收、历史展开和暂停新任务；服务端fixture只能证明界面行为，完整链路仍需真实API及Lody会话验证。

实际接口已落定：所有task公开投影增加claimable/recoverable/blockedReason/recoveryRequestSeq/recoveryConsumedSeq；服务端在项目锁内共享claimBlockReason计算资格。recover输入必须携带recoveryRequestSeq，成功认领消费，重复retry未消费时合并，queued的retry由首次claim消费。Skill等待直接使用资格布尔值，避免复制服务端占用算法。可执行资格与恢复序号已通过定向接口测试；集成与宿主验证见下文。

## 画板选择轮次的唯一提交事实

已连接任务调度的画板，原SubmitBar仍是明确提交入口；改为一次提交持久任务，不同时创建旧anchor.round/submit控制批注。任务存储的原子save同时保存roundId、roundContext及相关普通线程快照，避免评论文件与任务文件跨文件双写。radio选择记录仍沿用原有语义，提交快照保留选中板、推荐来源、轮次/组和相关意见。仅选择无文字批注也能建任务，零普通输入线程允许空replies，结果由任务卡验收。

GET input给出服务端round预览和version；submit的round分支与普通selection分支互斥。version覆盖当前轮次、选择及相关批注，锁内核对；同submissionKey先识别原意图幂等结果，再检查新输入。一个轮次未取消任务阻止另key重复创建；取消后新明确提交可创建新任务。task.roundId供画板把已提交、执行中、待验收映射到真实任务，不用心跳称“正在画”。取消使用原子task cancel，不能用旧withdraw仅改变评论而让任务继续。

未连接且查询成功确认时沿用原本地watcher/手工提交。连接暂停、失权、加载失败不等于未连接，不能回退旧入口造成双发。未知响应保留持久submissionKey并查询任务，重试不生成新身份。此方案不增加服务器执行Agent或外部监听；旧轮次控制记录不会由新路径重复发出。

验收：真实画板radio手势→原SubmitBar→单一持久任务→Agent读取完整轮次选择和意见→结果/验收；重复点击及响应丢失只一个任务；未连接旧路径保留；已连接状态不依赖listening。后端只做定向no-build测试，UI持完整构建权，最终真API联调由调度负责。

轮次实际契约已核对：input.rounds含id/version/page/title/state/groups/threadCount；submit round与selection互斥。task列表保留roundId、详情含roundContext.canvas/threads/choiceRecords；实际task.threads仅open普通线程，零线程replies可空。group.choice=null保留未回答语义。已有legacy提交/关闭轮次不能新提交；accepted仍占用原轮次，下一迭代需新轮次。源revision也纳入version；同key重放在当前轮次验证前返回旧任务。实现已纳入整合分支，并通过真实浏览器与独立 Lody 会话验证。

## 实现验证与限制

整合版本通过类型检查、完整构建和 230 个测试文件的 1892 项测试。独立隔离作品完成真实浏览器提交、Lody 一次性条件续接、认领、实际修改、结果回读和用户验收；文档与画板的输入输出修订均不同。画板覆盖原选择按钮与零文字轮次，并在服务端保存后主动断开首次响应，重试仍返回同一任务，未写旧轮次提交标记。最新构建的桌面中文与手机英文入口也已回读真实持久任务。

首个宿主实验误将服务端作品目录作为客户端工作区，触发修订冲突；分离客户端后，显式恢复完成回复和重新等待。该恢复没有再次修改正文，不能当作正常修改证据；后续独立文档、画板路径才证明实际修改上传。暂停期间不唤醒、恢复后自动接续已实测；daemon 重启、真实用户 Stop/归档生命周期及生产部署尚未验证，不以官方能力说明替代实测。

早期整合失败暴露 CLI 参数回归、嵌入式 viewer 的固定服务器路由依赖和测试环境问题，均修复后再跑全量通过。一次旧迁移测试时序失败未复现，保留为验证限制。真实手机和读屏未测试。发布后仍需分别核验远端 CI、版本产物和线上行为；本地通过不等于生产已部署。
