# dsh-build-resolver-java ☕️

> **Surgical build, compilation, and dependency error resolution plugin for DeepSeek Harness (DSH).**
>
> Inspired by ECC's (`Everything Claude Code`) `java-build-resolver`, heavily adapted and reinforced for DeepSeek models, the Cordis plugin lifecycle, and modern enterprise Java ecosystems.

[中文文档](README.zh-CN.md)

---

## 🌟 Why dsh-build-resolver-java?

When AI agents work on Java / Maven / Gradle codebases, compiler errors commonly trigger chaotic failure loops:
1. **Uncontrolled Refactoring**: The agent rewrites entire methods or classes instead of making minimal, surgical fixes.
2. **Cascading Errors**: Guessing at generic bounds, overloads, or annotation processor bugs often compounds errors.
3. **Environment Blind Spots**: Missing Jakarta EE namespace migration rules, Lombok/MapStruct processor order conflicts, or network mirror timeouts.

**`dsh-build-resolver-java` introduces strict engineering discipline:**
- 🎯 **Surgical Fixes Only**: Never refactor business logic; fix only what failed compilation.
- 🛡 **Three-Strike Circuit Breaker**: Aborts and reports root causes after 3 unsuccessful attempts on the same error.
- 🇨🇳 **Enterprise Environment Awareness**: Handles encoding mismatches (Windows GBK), JDK 17/21 reflection limits (`--add-opens`), Maven Enforcer convergence rules, and MyBatis XML packaging omissions.
- ⚡️ **ReDoS-Resistant Parser Engine**: High-performance linear parser (<3ms) with zero context bleeding between adjacent errors.
- 🧩 **First-Class DSH Integration**: Registers runtime tools (`java_parse_build_errors`, `java_inspect_project`), system prompt guidance, and native Skill (`java-build-resolver`).

---

## 📦 Installation

Install into your active DSH profile using the DSH CLI:

```bash
# Method 1: Install directly from GitHub (Recommended before npm publication)
dsh plugin --profile web add github:gandig/dsh-build-resolver-java

# Method 2: Install from NPM (after publication)
dsh plugin --profile web add dsh-build-resolver-java

# Method 3: Install from local source during development
dsh plugin --profile web add ./
```

---

## 🛠 Provided Capabilities

### 1. In-Memory Skill (`java-build-resolver`)
Registered directly into the DSH Skill catalog (`ctx.skills.register`).
When compiler errors occur, DeepSeek Harness automatically invokes `/java-build-resolver` to guide step-by-step resolution.

### 2. Model-Facing Tools (`ctx.tools`)
- **`java_parse_build_errors`**: Parses raw Maven or Gradle terminal logs, stripping ANSI codes and timestamps, and returns structured `[file:line:col]`, classified categories, symbols, and surgical fix recommendations.
- **`java_inspect_project`**: Inspects `pom.xml` or `build.gradle` to detect the build tool, framework (Spring Boot / Quarkus / General), and static configuration risks (e.g. missing UTF-8 encoding or MyBatis XML mapping rules).

---

## 🚀 Workflow

```text
1. Inspect Project   -> Detect build tool, framework, and configuration risks
2. Capture Failure   -> Run lightweight compile commands (mvn compile / gradle compileJava)
3. Structured Parse  -> Extract exact coordinates and error classifications
4. Surgical Fix      -> Apply minimal line-level edits (imports, dependencies, annotations)
5. Verify & Repeat   -> Recompile to confirm error reduction
6. Circuit Breaker   -> Terminate and report if the same error persists 3 times
```

---

## 📂 Project Structure

```text
dsh-build-resolver-java/
├── cordis.patch.yml           # Official DSH profile bundle patch (top-level array)
├── icon.svg                   # Plugin display icon (vector)
├── locale/                    # DSH display metadata
│   ├── en.json
│   └── zh.json
├── src/
│   ├── index.ts               # Cordis plugin entry (tools, prompt, skill registration)
│   ├── parser.ts              # High-performance build log parser & classifier
│   └── types.ts               # Type definitions
├── skills/
│   └── java-build-resolver/
│       ├── SKILL.md           # Surgical resolution instructions & red lines
│       └── patterns.md        # Reference dictionary of common compiler errors
├── test/
│   └── parser.test.ts         # Comprehensive test suite (Node.js test runner)
└── package.json
```

---

## 📄 License

[MIT License](LICENSE)
