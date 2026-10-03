# PeerBridge 闸门

钉住的版本是 `v0.1.0-alpha.6`（检出 `af87b27b15f5e56a23df88170df5b72b9248a3f0`），装在 `/Users/mac/tools/peerbridge-mcp`。它是编码客户端之间的本地协调层。它不替代 Git、CI、看板、`CODING_STANDARDS.md` 评审，也不替代人的批准。AI 评审不是安全审计。

两个仓库各有自己的库，scope 都是 `ipd`：

- `/Users/mac/Documents/ruoyi-ipd-web/.peerbridge/peerbridge.sqlite3`
- `/Users/mac/Documents/ruoyi-ai/.peerbridge/peerbridge.sqlite3`

不要把两个仓库指到同一个数据库。`.peerbridge/` 不入库，里面可以有对话和任务元数据，库本身不加密。

## 身份与 MCP

`cursor-ipd` 已按 collaborator 签发，两个仓库各一份。签发走本机 `human-operator` 的 `decide_permission`，decision 当场被 `identity issue` 消费。capability 文件留在各自 `.peerbridge/`，路径只写进本机 `~/.cursor/mcp.json` 的 `peerbridge-ipd-web` 和 `peerbridge-ipd-ai`。不要把 capability 内容写进参数、对话或文档。

stdio 服务参数只有 `--project-root`、`--agent-id cursor-ipd`、`--identity-capability`、`--scope ipd`。不传 `--client-name`、`--provider-id`、`--model-id`、`--route-class`：未绑定的 v2 capability 不能自证路由标签。

2026-10-01 的 stdio 握手：`initialize` 成功，工具 36 个，含 `claim_task` 和 `complete_task`。`bridge_status` 的 scope 是 `ipd`，database 指向该仓库自己的 `peerbridge.sqlite3`。随后 `doctor`：两个库 `ok`，schema 27 current，审计链 valid，`event_count` 4。

Cursor 重新加载 MCP 之前，已经打开的会话动态工具里仍然没有 `claim_task`。那种会话的状态仍是 `PENDING_PEERBRIDGE`。加载之后才按下面的工具链领租约。

再签发另一个客户端时，仍要新的控制室 decision id，不能复用已消费的 id，也不能手写库。撤销只走控制室。

## 工具链

写入前 `workboard`，再 `claim_task`。写范围用仓库内相对路径，禁止把仓库根当成写范围。读路径可以重叠。任一方带写路径且重叠，就停止，不改那些文件。

租约要 `renew_task`。做不完用 `release_task`，状态用 `open` 或 `blocked`。完成只用 `complete_task`。

改动已经落在工作区之后，用 `record_proof` 记下变更路径、测试命令和结果。评审用 `request_review`，绑定工件路径。`submit_review` 必须是另一个 peer。同一 agent 重复提交不算第二票。

`complete_task` 会重新哈希。文件变了，旧证明作废。然后 `verify_audit_chain`。链只证明本地库里的事件还连续。库被直接改掉、链尾又没在外部锚定时，库自己证明不了删除。

`submit_patch` 只写隔离草稿，不自动应用到仓库。不因为评审通过就执行破坏性命令。

审批策略用 `presence_aware`：有别的 peer 在线就要求评审；不在线就记下单人回退。单向门（撤不回、数据丢失、对外发送、迁移代价很高）即使策略允许单人，也停在人工评审。

## 和三道刹车的顺序

1. 领到写租约。
2. 实现。实现者不读 `CODING_STANDARDS.md`。
3. 确定性检查，命令仍以该仓 `AGENTS.md` 为准。
4. `record_proof`。
5. `code-review` 对照 `CODING_STANDARDS.md`，问题直接改工作区，改完补一次证明。
6. 按 `presence_aware` 做 peer 评审。
7. `complete_task`，再 `verify_audit_chain`。
8. 给人的说明仍用 `pr` 的 Summary、Evidence、Merge Danger。

子代理默认只读。要写就换一个 agent id，领取不重叠的写路径。不并行开 worktree，除非用户当次明确要求隔离 worktree。

看板仍是事项源。`complete_task` 通过不等于看板卡已完成。未经当次明确要求，不 commit、不 push、不建分支、不开 PR。

## 工具还没出现时

当前会话的动态工具里没有 `claim_task` 时，状态写 `PENDING_PEERBRIDGE`。不要写成 PeerBridge 已闭环。

这一状态下不启动第二个写入者。回复里的 Evidence 附上变更文件的 `shasum -a 256`。说完成之前再算一次。哈希变了就先说明漂移，不要沿用旧结论。
