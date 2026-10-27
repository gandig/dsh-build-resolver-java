# Java 常见编译与构建错误外科手术修复速查表

| 报错信息（Regex / 关键词） | 常见根因 | 建议外科手术修复方案 |
| :--- | :--- | :--- |
| `cannot find symbol: class X` | 漏写 import 或依赖缺失 | 优先补充 `import`；若类完全不存在，核对模块间 dependency |
| `cannot find symbol: method getId() / builder()` | Lombok 注解处理器未生效 | 检查 `maven-compiler-plugin` 或 Gradle `annotationProcessor` 是否配置 lombok |
| `cannot find symbol: method X(...)` | 方法入参类型或个数与签名不匹配 | 核对方法签名，按最窄入参类型补齐或强转，严禁重写方法本身 |
| `incompatible types: X cannot be converted to Y` | 类型声明或返回值不匹配 | 检查泛型擦除、显式类型转换或调用 `.toString()` / `.intValue()` |
| `incompatible types: Optional<T> cannot be converted to T` | 未解包 Optional | 补充 `.orElse(null)` 或 `.orElseThrow(...)` |
| `method X in class Y cannot be applied to given types` | 入参个数或重载匹配错误 | 核对重载函数签名，按正确顺序或重载入参传递 |
| `variable X might not have been initialized` | 局部变量在部分分支未赋值 | 在声明或分支使用前赋予初值（如 `null`, `0`, `false`） |
| `non-static method X cannot be referenced from a static context` | 静态方法中直接调用实例方法/字段 | 构造对象实例调用，或在纯无状态辅助方法上添加 `static` 修饰 |
| `package javax.servlet / javax.persistence does not exist` | Spring Boot 3+ Jakarta 升级 | 全局替换为 `jakarta.servlet.*`、`jakarta.persistence.*` |
| `No implementation was created for XMapper` | MapStruct 与 Lombok 处理器加载顺序错误 | 检查 POM 中 `annotationProcessorPaths`：lombok 必须排在 mapstruct 之前，且引入 `lombok-mapstruct-binding` |
| `Annotation processor threw uncaught exception` | 注解处理器版本冲突或版本过旧 | 升级 Lombok / MapStruct 至支持当前 JDK 的最新版本 |
| `Source option X is no longer supported` | JDK 编译器 release 版本过低 | 调整 `maven.compiler.source/target/release` 匹配当前 JDK |
| `has been compiled by a more recent version of the Java Runtime` | 类字节码版本高于运行期 JVM (如 class 65 -> JDK 21) | 统一本地编译环境与目标依赖使用的 JDK 主版本 |
| `Could not resolve: group:artifact:version` | 网络超时、镜像不通或私服缺失 | 配置阿里云公共镜像源或核对公司企业私服 credentials |
| `unmappable character (0xXX) for encoding ...` / `unmappable character for encoding GBK` | Windows 默认 GBK 导致含中文源码编译报错 | 在 POM properties 中配置 `<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>`，并在 `maven-compiler-plugin` 声明 `<encoding>UTF-8</encoding>`；Gradle 设置 `tasks.withType(JavaCompile) { options.encoding = 'UTF-8' }` |
| `InaccessibleObjectException: module java.base does not "opens java.lang" to unnamed module` | JDK 17/21 强封装反射限制 | 在 `maven-surefire-plugin` 或构建插件配置 `<argLine>--add-opens java.base/java.lang=ALL-UNNAMED</argLine>`；Gradle 配置 `jvmArgs += ['--add-opens', 'java.base/java.lang=ALL-UNNAMED']` |
| `Rule 0: org.apache.maven.plugins.enforcer.BannedDependencies failed` / `Found Banned Dependency: X` | 依赖中引入了企业禁用的组件（如 commons-logging / log4j 1.x） | 在直接依赖项下添加 `<exclusions><exclusion><groupId>...</groupId><artifactId>...</artifactId></exclusion></exclusions>` 排除违规传递依赖 |
| `Rule 1: org.apache.maven.plugins.enforcer.DependencyConvergence failed` / `Dependency convergence error for X` | 项目中存在多版本依赖冲突导致依赖不收敛 | 在父 POM `<dependencyManagement>` 中显式声明统一版本，强制锁定全局一致版本 |
| `Invalid bound statement (not found): com.xxx.mapper.XMapper.method` | Mapper XML 在 `src/main/java` 未被 Maven 打包 | 在 `pom.xml` 的 `<build><resources>` 增加 `<resource><directory>src/main/java</directory><includes><include>**/*.xml</include></includes></resource>`，或将 XML 移入 `src/main/resources/mapper/` 并配置 `mybatis-plus.mapper-locations` |
| `Checkstyle / SpotBugs violation: ...` | 静态代码规范不合规（行长度、空行等） | 按具体违规行做最小格式微调，禁止借机重构其余无关代码 |
