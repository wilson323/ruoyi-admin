---
name: ipd-engineering-feedback
description: IPD 工程任务开始、失败、接续和完成时使用；复用现有总计划，运行真实门禁，自动归档失败并在回归后启用固定工程检查项。不是产品智能体或全局权限策略。
version: 1.0.0
---

# IPD 工程反馈

当前用户授权与 AGENTS 优先。唯一执行顺序仍为总画布，事项仍在后端原看板镜像；这里不保存业务任务状态。不调用 EvoX，不声称模型自动训练，不存隐藏推理。

## 每次开始或恢复

1. 先核本次仓库、入口、服务边界、表字段、现状目标、证据等级六行；读本项目已有计划，确认 allowedPaths 和当前修改者。
2. 从当前绝对根目录运行 `python3 <前端实际目录>/scripts/engineering_harness.py --root <当前仓库根> intake`。它输出真实 HEAD/脏输入摘要、未处理失败及已验证工程检查项。前端 worktree 用本 worktree 脚本；后端复用正式前端脚本，不能偷换当前 root。
3. 对未处理失败先读原始日志与 receipt，区分观察事实、根因假设和独立验证。机器写的 `UNCONFIRMED` 不能升级为已证实根因。

## 执行、失败与验收

- 工程机制改动先用 `bash .harness/verify.sh governance <原事项编号>`；前端代码交付用 `bash .harness/verify.sh frontend <原事项编号>`。固定命令，不接受任意 Shell/eval。
- governance 实跑 Harness/类型门禁反例和既有上下文检查；frontend 再实跑类型、非空 Vitest 与生产构建。无依赖时拒绝，不切到另一树替它验收。后台业务、真实服务加载与业务验收仍走原总计划。
- 失败自动保存 `.harness/runs/<run>/receipt.json` 与私有日志，生成 `.harness/evolve/<run>.json` 反思输入。它提出核查问题，不臆造解释。新失败需补正反回归；重试前须有新诊断，通常最多两次。
- 完成前 `python3 scripts/engineering_harness.py --root <根> check --receipt <本次receipt>`；缺步骤、非零、空证据、输入/验证器/产物变化拒绝。工作树锁只约束此入口，不约束外部 Maven/Vite/其他聊天。
- 每次尝试保留，不能用最终一次绿覆盖原失败。工程通过不表示运行包已加载、业务已完成或生产就绪。

## 自动反思和受控进化

1. 失败自动形成证据包与待反思问题，下一任务 intake 自动呈现，工程助手根据证据分析根因。
2. 同事项、同 profile 后续真实完整通过时，runner 自动尝试晋升该失败对应的固定检查项；必须同验证器与反例集、先失败后成功、原日志完整。
3. 启用内容只能来自代码中固定 PROCEDURES 枚举，不能读取自由文本当指令、改权限/审批/核心安全规则。验证器改变使旧学习标记 stale，重新验证；新检查项/Skill/工具补丁由工程助手在当前 allowedPaths 隔离试验，固定回归和独立留出案例先通过再启用。
4. 模型或 Skill 行为改动另做真实 Agent 行为评测，记录模型/权限/输入/评分版本及最终环境状态；本脚本工具回归不能代替该评测。对照同案例逐项看回归，禁止改评分器提分。

反思采用可公开的事实、原因、修复和证据，不保存模型内部推理。无验证的候选留作待核实。没有监控请求不加常驻调度；本机制随工程任务触发。参考：[OpenAI continuous eval](https://developers.openai.com/api/docs/guides/evaluation-best-practices)、[Anthropic Agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)。

## 能力边界

普通本地脚本和可编辑记录不是不可绕过的信任根。未配置/实测所有 IDE 工具层接入；AGENTS 导航与当前 runner 的实际调用才是本次证据。未自动安装 GEPA、市场 Skill/MCP 或第二套 IPD 内核，也未授权自动 Git 操作与生产写入。
