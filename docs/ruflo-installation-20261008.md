# Ruflo 安装、控制器修复与验收（2026-10-08）

裁决：本机安装及新进程下的七个控制器已通过本页所列工程验收；当前聊天连接已重新加载，并通过下述实际写入回读及审计取证；不能据此宣称 381 个工具全部验收或 IPD 业务完成。

## 实际安装

- Node 22.22.3；Ruflo 3.55.0；AgentDB 3.0.0-alpha.20。全局入口 `/Users/mac/.hermes/node/bin/ruflo`。
- 全局安装 `@claude-flow/codex`、`@claude-flow/aidefence`、`agentic-flow`、`agent-browser`。本项目运行配置由官方 `ruflo init --full --skip-claude --no-global --no-signup --no-skills-sh --force` 初始化；原运行数据保留。
- 官方技能根 `/Users/mac/.agents/skills/ruflo`。`scripts/register-ruflo-skills.py` 从实际目录递归登记了 164 个插件技能到 Codex，避免仅凭上游宣传数字报告安装数量。登记脚本不覆盖其他已有技能。
- 官方全量初始化曾在临时目录验证，生成技能、命令和智能体定义；该 staging 不代表全局智能体已运行。验证后已清理 staging，实际安装包和已登记技能仍在。
- Codex 的 MCP 配置使用绝对 Node/包入口，超时分别为 60/180 秒；只保留 `ruflo` 服务，移除重复的 `claude-flow` 启动配置。既有连接要由客户端重新加载，配置修改本身不替旧进程加载模块。

上游来源：[Ruflo 官方仓库](https://github.com/ruvnet/ruflo)、官方 npm registry。付费/认证云服务未配置；未收集凭据。doctor 曾报告磁盘占用及本地依赖探测警告，不能声称 doctor 全绿。

## 根因及修复

1. 当前 AgentDB 发布包缺少 CLI 所引用的五个实现文件；旧补充初始化还使用了错误的构造参数和注册表成员，缺文件/构造失败被静默跳过。
2. 原生语义路由的 CommonJS 导出与 ESM 命名导入不匹配；旧图数据库入口把文件检查故障吞掉，可能重建已有图状态。
3. GNN 原生边界需要正确类型、维度和有限值；向量后台的异步调用必须 await，不能把启动调用当成已完成。
4. 证明与审计消费者调用错了接口，不能只看控制器 enabled 判断真实写入已经受约束。

修复沿现有 Ruflo memory bridge 接入一个经过指纹核验的 sidecar，并删除同七个控制器的旧静默补充分支；未知版本拒绝套用。安装版本没有降级；缺失实现取自官方 AgentDB alpha.9 归档，文件原始指纹及声明 MIT 的原包元数据保留在 `scripts/ruflo-controller-repair/copied-agentdb/`；该归档未附独立许可证正文，不编造版权声明。边界适配属于本机修复，不能宣称原版 alpha.20 自带这些实现。

入口与合同见 [修复源码说明](../scripts/ruflo-controller-repair/README.md)。修复只提供工程证明，不授予 Person、业务写入、审核或 Gate 权限。

## 可复跑验收

```sh
python3 scripts/install-ruflo-controller-repair.py
node /Users/mac/.local/share/ruflo/controller-repair/security-gnn-rvf.test.mjs
node /Users/mac/.local/share/ruflo/controller-repair/graph-router-test.mjs
node /Users/mac/.local/share/ruflo/controller-repair/bridge-integration.test.mjs
python3 scripts/verify-ruflo.py
python3 scripts/register-ruflo-skills.py
```

实际新 MCP 进程列出 381 个工具；23 个控制器状态启用，包括原先失败的七个。验收另外执行了原生向量写入/检索、过期证明/非法维度/NaN 拒绝、原生 GNN、真实 4-bit 压缩、图和语义路由跨进程回读、具体 MCP 写入的 SQLite 审计行、新 MCP 进程重启后值回读和测试项清理。损坏图状态拒绝启动且保留原文件，不静默重建或回落。

本轮首次并发复验曾暴露测试共享 cwd 的原生数据库锁冲突：SQLite `:memory:` 不阻止原生向量后端创建文件。安全测试已改用唯一临时目录并 finally 清理；两个同测试进程并发实跑均退出 0。失败不能抹去，问题与修复记录保留。

本页验收只覆盖已配置的 384 维链路及上述具体操作，不涵盖任意向量维度、全部工具、上游其他控制器的所有方法、云认证或真实业务全链路。原有 consolidation 等实现没有被这次测试认证。

## 清理和恢复

移除本次临时解包目录和全量初始化 staging，共 957 文件、9,579,605 字节；移除旧校验器的重复状态规则和临时调试输出。保留官方归档、原 bridge 备份、故障原始记录和修复运行目录。数据库文件仍被 Qoder/旧 MCP 打开，未删除或终止这些进程。清理输出见本机 `/Users/mac/.local/share/ruflo/cleanup-verification.json`。

另清理本轮 12 个测试临时目录及一个失败尝试遗留的有效测试记忆；真实 SQLite 回读 `installation-verification` 命名空间有效条目为 0，软删除记录与审计保留。测试脚本补 finally 清理，不仅靠事后删除。

恢复安装执行上述 installer；它需要原 bridge 备份和已核验依赖。全局配置备份在 `~/.codex/config.toml.before-ruflo-20261008`、`~/.codex/config.toml.before-ruflo-canonical-20261008`，只作本机恢复，不入版本库。所有数据库、锁、凭据与运行日志均不提交。

机器可读证据见 [验收摘要](evidence/ruflo-20261008.json)。工程防复发入口仍是 `.harness/skills/ipd-engineering-feedback/SKILL.md`；不新建 IPD 运行轨或业务台账。

## 当前聊天连接复验（2026-10-08 15:30 UTC）

本次直接调用当前聊天的 `ruflo` MCP：`system_info` 返回进程 17653；`agentdb_health` 返回 23 个启用控制器，其中含原先失败的七个。`memory_store` 在 `installation-verification` 写入 `live-chat-20261008`，返回 384 维 embedding；`memory_retrieve` 逐项读回原值；SQLite `mutation_attestations` 按 namespace、operation=store、status=proved 及 invariantChecks 中的精确 key 筛选，命中 id=239。随后 `memory_delete` 成功。该结果证明当前连接的这条写入链路已应用修复，不证明其他 IDE 连接或所有工具的方法。
