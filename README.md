# dsh-build-resolver-java ☕️

> **Java / Maven / Gradle 构建与编译故障定点修复专家插件** (面向 DeepSeek Harness / DSH 生态)
>
> 灵感源自 ECC (Everything Claude Code) 的 `java-build-resolver`，针对 DeepSeek 模型推理特性与国内 Java 企业级生产环境做了深度增强与本土化升级。

---

## 🌟 为什么需要它？

在日常使用 AI 智能体开发 Java 项目时，一旦运行 `mvn compile` 或 `gradle build` 报错，通用 AI 往往会出现以下痛点：
1. **胡乱重构**：本只需加一个 `import`，AI 却把整个方法或业务类从头重写，改坏原本正常的逻辑。
2. **越修错越多**：面对泛型、重载或注解处理器冲突时，盲目修改方法签名，引发连锁编译报错。
3. **环境水土不服**：不清楚 Spring Boot 3 的 `jakarta.*` 升级要求、Lombok/MapStruct 处理器加载顺序，或者直接被国内 Maven 镜像超时卡死。

**`dsh-build-resolver-java` 为 DSH 注入了严苛的工程纪律：**
- 🎯 **外科手术式修复（Surgical Fixes Only）**：绝不重构业务代码，只做最小行级修改。
- 🛡 **三击熔断保护（Three-Strike Rule）**：同一错误修改 3 次不通过立即中断并分析深层原因，杜绝死循环。
- 🇨🇳 **国内企业级暗坑深度覆盖**：
  - Windows GBK 编码致中文源码错乱 (`unmappable character` -> `project.build.sourceEncoding` UTF-8)；
  - JDK 17/21 强封装反射限制 (`InaccessibleObjectException` -> `--add-opens` 模块导出)；
  - Maven Enforcer 禁令与依赖收敛拦截 (`BannedDependencies` 排除 & `DependencyConvergence` 版本锁定)；
  - MyBatis / MyBatis-Plus 资源打包漏打 (`Invalid bound statement` 绑定失败与 POM resources XML 构建期检测)；
  - 阿里云公共镜像与企业私服超时/PKIX SSL 诊断。
- ⚡️ **结构化日志解析引擎**：直接解析提取控制台报错的 `[file:line:col]`、错误类型与关键 Symbol，精准投喂给 DeepSeek。

---

## 📦 安装与启用

### 在 DSH 终端中安装：
```bash
# 方式 1：通过 NPM 安装（发布后）
dsh plugin --profile web add dsh-build-resolver-java

# 方式 2：直接通过 GitHub 仓库安装
dsh plugin --profile web add github:ihuajiu/dsh-build-resolver-java
```

---

## 🚀 核心工作流

```text
1. 框架与环境探查   -> 自动判定 Spring Boot (2.x/3.x) / Quarkus / 通用 Java 与本地 JDK 版本
2. 捕获编译错误     -> 运行轻量 compile 并结构化解析报错行列号与类型
3. 定位上下文       -> 只读取报错行周边上下文，不加载多余代码
4. 外科手术式修复   -> 补齐 import、调整依赖 scope 或修正局部类型
5. 单步编译验证     -> 重新编译确认错误递减
6. 熔断保护检查     -> 超过 3 次未修复立即停止汇报
```

---

## 🛠 插件结构

```text
dsh-build-resolver-java/
├── src/
│   ├── index.ts               # DSH/Cordis 插件主入口 (Tool 注册与系统提示词注入)
│   ├── parser.ts              # Maven/Gradle 编译日志正则提取与分类引擎
│   └── types.ts               # 类型定义
├── skills/
│   └── java-build-resolver/
│       ├── SKILL.md           # 核心专家规则与工作流指令（移植并升级自 ECC）
│       └── patterns.md        # 常见错误外科手术修复速查表
├── test/                      # 单元测试
├── package.json
└── tsconfig.json
```

---

## 📄 开源许可

[MIT License](LICENSE)
