---
'anjian-workflow': patch
---

<!-- anjian:zh -->

#### 中文

从安装包运行 `anjian start` 时，会继续使用仍在响应的源码 Hub。监听配置有冲突时，可以先用 `anjian stop` 明确停止，再用新配置启动。Hub 停止响应时仍可替换。到本机 Hub 状态目录下的 `hub-events.jsonl` 查看保留、替换与停止的原因。

<!-- anjian:en -->

#### English

Running the packaged `anjian start` keeps a responsive Hub built from source. To change its listening settings, explicitly stop it with `anjian stop` and start with the new settings. An unresponsive Hub can still be replaced. Check `hub-events.jsonl` in the Hub state directory to see why it was kept, replaced, or stopped.

<!-- anjian:end -->
