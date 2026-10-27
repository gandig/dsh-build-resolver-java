# dsh-build-resolver-java ☕️

> **Java / Maven / Gradle 构建与编译故障定点修复专家插件** (面向 DeepSeek Harness / DSH 生态)
>
> 灵感源自 ECC (`Everything Claude Code`) 的 `java-build-resolver`，针对 DeepSeek 模型推理特性、Cordis 插件生命周期与现代企业级 Java 生产环境做了深度增强与本土化升级。

[English Documentation](README.md)

---

## 🌟 为什么需要它？

在日常使用 AI 智能体开发 Java 项目时，一旦运行 `mvn compile` 或 `gradle build` 报错，通用 AI 往往会出现以下痛点：
1. **胡乱重构**：本只需加一个 `import`，AI 却把整个方法或业务类从头重写，改坏原本正常的逻辑。
2. **越修错越多**：面对泛型、重载或注解处理器冲突时，盲目修改方法签名，引发连锁编译报错。
3. **环境水土不服**：不清楚 Spring Boot 3 的 `jakarta.*` 升级要求、Lombok/MapStruct 处理器加载顺序，或者直接被国内 Maven 镜像超时卡死。

**`dsh-build-resolver-java` 为 DSH 注入了严苛的工程纪律：**
- 🎯 **外科手术式修复（Surgical Fixes Only）**：绝不重构业务代码，只做最小行级修改。
- 🛡 **三击熔断保护（Three-Strike Rule）**：同一错误修改 3 次不通过立即中断并分析深层原因，杜绝死循环。
- 🇨🇳 **企业级暗坑覆盖**：处理中文 Windows 编码异常（GBK）、JDK 17/21 强封装反射限制（`--add-opens`）、Maven Enforcer 依赖收敛与 MyBatis XML 资源漏打。
- ⚡️ **免疫 ReDoS 的解析引擎**：线性解析日志（<3ms），彻底消除相邻报错间的“上下文串味”误判。
- 🧩 **全生命周期 DSH 集成**：同时提供运行时工具（`java_parse_build_errors`, `java_inspect_project`）、系统提示词指导与原生 Skill（`java-build-resolver`）。

---

## 📦 安装与启用

### 在 DSH 终端中安装：
```bash
# 方式 1：通过 NPM 安装（发布后）
dsh plugin --profile web add dsh-build-resolver-java

# 方式 2：开发阶段从本地源码目录安装
dsh plugin --profile web add ./
```

---

## 🛠 提供的核心能力

### 1. 内嵌式运行时 Skill (`java-build-resolver`)
通过 `ctx.skills.register` 自动注册进 DSH 技能目录。当编译失败或用户输入 `/java-build-resolver` 时，DeepSeek 智能体自动唤醒该流程进行逐步定点排查。

### 2. 模型可调用工具 (`ctx.tools`)
- **`java_parse_build_errors`**：解析 Maven 或 Gradle 终端输出，自动剔除 ANSI 彩色字符与 CI 时间戳，返回结构化坐标 `[file:line:col]`、错误分类、关联符号及外科手术修复动作。
- **`java_inspect_project`**：静态检测 `pom.xml` 或 `build.gradle`，识别技术栈与潜在配置风险（如编码缺失、MyBatis XML 漏打包）。

---

## 🚀 核心工作流

```text
1. 框架与环境探查   -> 自动判定 Spring Boot (2.x/3.x) / Quarkus / 通用 Java 并提前预警配置风险
2. 捕获编译错误     -> 运行轻量 compile 并结构化解析报错行列号与类型
3. 定位上下文       -> 只读取报错行周边上下文（±15行），不加载多余代码
4. 外科手术式修复   -> 补齐 import、调整依赖 scope 或修正局部类型
5. 单步编译验证     -> 重新编译确认错误递减
6. 熔断保护检查     -> 超过 3 次未修复立即停止汇报
```

---

## 📂 项目结构

```text
dsh-build-resolver-java/
├── cordis.patch.yml           # 官方 DSH profile bundle patch (顶层数组格式)
├── icon.svg                   # 插件矢量图标
├── locale/                    # DSH 多语言展示元数据
│   ├── en.json
│   └── zh.json
├── src/
│   ├── index.ts               # Cordis 插件入口 (Tools / Prompt / Skill 注册)
│   ├── parser.ts              # Maven/Gradle 编译日志正则提取与分类引擎
│   └── types.ts               # 类型定义
├── skills/
│   └── java-build-resolver/
│       ├── SKILL.md           # 核心专家规则与工作流指令（移植并升级自 ECC）
│       └── patterns.md        # 常见错误外科手术修复速查表
├── test/
│   └── parser.test.ts         # 自动化测试用例
└── package.json
```

---

## 📄 开源许可

[MIT License](LICENSE)
