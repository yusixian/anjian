---
'anjian-workflow': patch
---

<!-- anjian:zh -->

#### 中文

修复 Codex 本地反馈监听遗漏画板选择轮次的问题。同一批检测到的多个轮次会分别发送给已订阅的会话。Hub 注册工作区时会在五秒后结束未完成的请求，避免持续返回数据的响应让注册进程一直等待。

<!-- anjian:en -->

#### English

Fix missed Codex notifications when multiple artboard choice rounds are submitted between polls. Each round is delivered separately to the subscribed session. Local Hub project registration now stops unfinished requests after five seconds, including responses that keep streaming data.

<!-- anjian:end -->
