# Java 常见编译与构建错误外科手术修复速查表

| 报错特征（Regex / 关键词） | 常见根因 | 建议外科手术修复方案 |
| :--- | :--- | :--- |
| `cannot find symbol: class X` | 漏写 import 或依赖缺失 | 优先补充 `import`；若整个类包不存在，检查构建文件 dependency |
| `cannot find symbol: method getId()` 等 | Lombok 注解处理器未生效 | 检查 `maven-compiler-plugin` 是否声明了 `lombok` 处理器 |
| `incompatible types: X cannot be converted to Y` | 类型声明或返回值不匹配 | 检查泛型参数、显式类型转换或适配目标方法出参 |
| `method X in class Y cannot be applied to given types` | 参数个数或类型不一致 | 核对重载函数签名，微调入参调用 |
| `variable X might not have been initialized` | 局部变量在某些分支未赋值 | 在使用前赋予初始安全默认值（如 `null`, `0`, `""`） |
| `non-static method X cannot be referenced from a static context` | 静态方法中直接引用了实例方法 | 创建对象实例调用，或在纯无状态工具函数上声明 `static` |
| `package javax.servlet does not exist` | Spring Boot 3+ Jakarta 升级 | 替换为 `import jakarta.servlet.*`（切勿全量盲替换 javax.*） |
| `InaccessibleObjectException: module java.base does not opens` | JDK 17/21 强封装反射限制 | 在 surefire 插件 `<argLine>` 添加 `@{argLine} --add-opens java.base/package=ALL-UNNAMED` |
| `unmappable character for encoding` | 源码编码与系统编码不一致 | 在 POM 配置 `<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>` |
| `Rule X: org.apache.maven.enforcer... failed` | 依赖收敛或禁令规则触发 | Banned 使用 `<exclusions>` 排除；Convergence 在 `<dependencyManagement>` 锁定版本 |
| `BindingException: Invalid bound statement (not found)` | MyBatis XML 资源漏打 | 在 `<build><resources>` 包含 `src/main/java` 下的 `**/*.xml` |
| `Annotation processor threw uncaught exception` | Lombok 与 MapStruct 顺序颠倒 | 调整 POM 中 annotationProcessorPaths 顺序，Lombok 居前 |
| `Source option X is no longer supported` | 本地 JDK 版本过高/低 | 调整 `maven.compiler.source` 或统一本地 JDK 版本 |
| `Could not resolve: group:artifact:version` | 网络超时、镜像不通或私服缺失 | 在 `~/.m2/settings.xml` 配置公共镜像源或核验企业私服凭证 |
