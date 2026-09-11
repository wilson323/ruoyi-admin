---
description: "Python 服务开发通用规范"
globs: "**/*.py"
alwaysApply: true
---

# Python 服务开发规范

## 一、架构约束（硬性红线）

1. 严格遵循分层：`api/`（路由）→ `services/`（业务）→ `repositories/`（数据）→ `models/`（模型）
2. 禁止在路由层写业务逻辑，路由只做参数校验和响应封装
3. 所有数据库操作必须通过 repository 层
4. 所有对外接口必须有类型注解 + Pydantic schema

## 二、代码风格

1. 全面类型注解（函数签名、返回值、类属性）
2. 错误处理不允许裸 `except:`，必须捕获具体异常并显式处理
3. 命名：模块/函数 snake_case，类 PascalCase，常量 UPPER_SNAKE_CASE
4. **单个函数不超过 80 行**，超过则拆分
5. 使用 `ruff` 做 lint + format，不使用 black/flake8 混搭

## 三、异步与资源

1. I/O 操作必须使用 async/await，禁止在 async 函数中调用阻塞 I/O
2. 数据库连接必须使用连接池 + context manager
3. 外部调用必须有超时设置（默认 30s）

## 四、安全

1. 所有用户输入必须经过 Pydantic 校验
2. SQL 必须使用参数化查询，禁止字符串拼接
3. 敏感配置通过环境变量或密钥管理服务读取

## 五、开发行为

1. 每个逻辑单元完成后立即 `ruff check . && mypy . && pytest`
2. 新增功能必须同步编写单元测试
3. 涉及 DB 变更优先生成 Alembic 迁移脚本