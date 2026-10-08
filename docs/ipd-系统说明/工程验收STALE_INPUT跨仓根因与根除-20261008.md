# 工程验收 STALE_INPUT 跨仓根因与根除

> 事件窗口：2026-10-08 15:37–15:38 UTC（两次 verify 均判 STALE_INPUT）
> 根除实施与复验：2026-10-08 18:32 UTC（governance profile，task `IPD-HARNESS-20261003`）
> 证据等级：本文结论均绑定实跑输出或 `文件:行号`；未能取证的条目显式标注**未取证**。

## 检查了什么

前端子命令 `engineering_harness.py verify` 在 18 秒内跑完 4 个治理检查后，
**不报告任何一个检查失败**，而是把整次验收标成作废（`STALE_INPUT`）。
即「验收身份」在开跑前就被判定无效，实际检查根本没机会表态。

复现现场的两份收据（读数取自 `.harness/runs/` 下对应 `receipt.json`）：

| run_id | status | before.head | before.hash vs after.hash |
|---|---|---|---|
| `20261008T153722-3e819b812043` | STALE_INPUT | `a154b21d` | **完全相同** |
| `20261008T153814-420e830f7416` | STALE_INPUT | `b05658f` | 不同 |

第一次的输入指纹前后一致、HEAD 前后一致，**输入没有任何变化**，却被判作废。

## 为什么反复出错

`STALE_INPUT` 的判定条件是「输入快照变化 **或** 验证器指纹变化」（`scripts/engineering_harness.py` 约 362–363 行，`or` 条件）。
两个分支里，前端仓自己的输入是干净的，所以嫌疑只剩验证器指纹。

而验证器指纹的算法有一个越界：

- 前端仓的「验证器指纹」把**后端仓 23 个门禁文件**也算进身份；
- 取字节的方式是 `path.read_bytes()`，读的是**工作树当前内容**；
- 于是**兄弟会话在后端仓一处未提交的编辑，直接决定前端仓验收的生死**。

这不是猜测，是被 `or` 条件逼出来的唯一解释：第一次运行时前端仓 7 个验证器文件
`git diff a154b21d b05658f` 全部 SAME（无变化），输入快照相同，仍判作废 →
只剩后端仓那一半。而后端仓当时有 14 个 tracked 文件处于未提交修改态。

### 为什么后果会放大成「永远做不完」

失败被如实记进了收据，但**没有被转成会红的检查项**：

- 事项 `IPD-HARNESS-20261003` 因上述越界而**永远拿不到 PASSED**；
- 检查项晋升要求「同事项、同 profile 先失败后成功」；
- 所以它的检查项集合恒为 `[]`，永远空转；
- 表现就是「反复失败、反复记录、反复重跑」，直到人不再相信这套验收。

### 为什么没人拦住

「任务结束必须提交」目前是**纯文档规则，没有物理收口点**：

- `engineering_harness.py` 的子命令只有 `intake` / `verify` / `check` / `learn`（556–571 行）；
- 全文没有任何 git 或提交检查；
- 前端仓 `.git/hooks/` 无 pre-commit（仅 `prepare-commit-msg`，Sep 4）。

规则写在文档里、执行口留空，等于把「记得提交」交给人的记性。

## 已实际修改

### 根除一：跨仓验证器改按「已提交态」取指纹（已实施并复验）

`scripts/engineering_harness.py` 新增 `foreign_validator_bytes()`（138–158 行），
并让 `validator_hash()`（161–186 行）对后端仓那一半改走它：

- 文件被 Git 跟踪 → `git show HEAD:path`，取**已提交**字节；
- 未跟踪 / 不在某个 Git 仓库内 → 回落到工作树字节（新建的门禁仍能被覆盖到）；
- 符号链接先 `resolve()` 到真实目标再判定，指纹等于目标内容。

语义变化一句话：**兄弟会话在**别的**检出目录里的未提交编辑，不再决定本仓验收的生死；
但对方一旦提交，HEAD 变了，身份照样作废。**

配套回归两条（`scripts/test_engineering_harness.py`）：

- `test_C59` —— 真 Git 外部仓：未提交编辑**不得**改变指纹；提交后**必须**改变指纹；
- `test_C60` —— `git init` 无提交的新增文件：仍须按工作树取指纹（不能被漏掉）。

并保留 `test_C54`（证据验证器改动必须使身份失效）作为不得破坏的正反对照点。

### 根除二：连带解除，已实跑取证

根除一落地后，原先永远拿不到 PASSED 的事项第一次通过（**A 级，实跑**）：

```
run_id : 20261008T183204-804a5cd143ae
task   : IPD-HARNESS-20261003   profile: governance
status : PASSED        EXIT=0
head  一致 : True 528670ccfc40
input 一致 : True count=2067
validator  : 487ba267c24aab5ddfcec93e
steps  : 4 个，全部 exit=0（harness-regression / typecheck-regression /
         context / engineering-evidence）
```

两处读数可交叉验证，说明这次 PASSED 不是巧合：

1. `validator` 前缀 `487ba267` 与本轮改造后独立实测的指纹**完全一致** → 指纹读数稳定可复现；
2. `input_count=2067` 比此前收据的 2068 少 1 → 正是本次 `.gitignore` 把
   `agentdb.rvf.idmap.json` 转为 ignored 所致，变更可解释、可追溯。

> 分层声明（照抄收据原文，不外推）：`validation_level=ENGINEERING_ONLY`、
> `runtime_loaded=NOT_VERIFIED`、`business_acceptance=NOT_VERIFIED`。
> **本文不构成运行态已加载或业务已验收的声明。**

### 根除三：只给结论，不擅自加门禁

「提交无物理收口点」是已取证的缺口，但**新增一个会失败的提交门禁属于带副作用的新能力**，
按工程规约不得未经测试与授权自动启用。本轮处置：

- **结论入库**（本文即为结论载体）；
- **最小可行方案**（待 owner 拍板后再实施，建议形态见下）；
- 不在本轮擅自上线。

建议形态（供拍板，非既成事实）：在 `verify` 的收据里记录「本次运行后工作树仍有未提交改动」，
并在 `check` 判定完成证据时对该事实显式表态——**先造证据，不先造红线**，
避免一上来就把正常开发态判死。

## 复验方法（可重跑）

```bash
cd /Users/mac/Documents/ruoyi-ipd-web
python3 scripts/test_engineering_harness.py --backend-root /Users/mac/Documents/ruoyi-ai
python3 scripts/engineering_harness.py --root "$PWD" verify \
        --profile governance --task IPD-HARNESS-20261003
```

第一条回归 60 项全绿（含新增两条与既有正反对照点）；
第二条退出码为 0 且收据 `status=PASSED`。

## 已作废的假设（留档防止复发）

排查过程中被实跑推翻过三次结论，一并记录，因为它们都属于「拿 A 处证据支撑 B 处结论」：

1. ~~STALE_INPUT 的成因是 `agentdb.rvf.idmap.json` 变化~~ → 两次运行该文件均无变化，作废；
2. ~~兄弟会话在改本文档同目录的某篇文档~~ → 只能解释第二次，不能解释第一次，作废；
3. ~~`.codex/hooks/...` 未被跟踪所以应读工作树~~ → 它是符号链接，
   `resolve()` 后读到的是被跟踪目标的已提交内容，**实现行为正确**，
   是取证脚本拿链接原路径做对比导致的口径错误。

## 未取证与边界

- **未取证**：第一次运行那 18 秒窗口内，究竟是后端哪个验证器文件被写入。
  文件时间戳只保留最后一次写入，无法回溯。可确证的是分支归属（已提交态读法），不是具体文件。
- 本轮只解除**工程层**作废；运行态是否已加载本次产物、业务是否验收，均未验证。
- 交接给 owner 的一项既有事实：前端仓远端 `origin` 为 `wilson323/ruoyi-admin`，
  本次推送仅限 owner 自己的分支 `teardown/incentive-removal`，不触碰 `main`。