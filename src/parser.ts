import { JavaBuildError, ParseResult, ErrorCategory, BuildTool, JavaFramework } from './types.js';

const MAX_PARSED_ERRORS = 100;

/**
 * Strips terminal ANSI escape codes (CSI, OSC, SGR, 256-color, 24-bit truecolor, cursor movement).
 */
export function stripAnsi(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '');
}

export function detectBuildTool(filesOrLog: string): BuildTool {
  if (!filesOrLog || typeof filesOrLog !== 'string') {
    return 'unknown';
  }
  const clean = stripAnsi(filesOrLog);
  if (
    /pom\.xml|<project[\s>]|<modelVersion>|xmlns[:\w]*="http:\/\/maven\.apache\.org|\[INFO\] Scanning for projects|\[INFO\] Total time:|org\.apache\.maven\.plugins|mvnw?\s+compile|Some problems were encountered while processing the POMs|Reactor Summary for/i.test(
      clean
    )
  ) {
    return 'maven';
  }
  if (
    /build\.gradle|\.gradle\.kts|plugins\s*\{|dependencies\s*\{|repositories\s*\{|apply\s+plugin:|sourceCompatibility\s*=|tasks\.withType|> Task :[^\r\n]*FAILED|Execution failed for task|gradlew?\s+compileJava|BUILD FAILED in|Task failed with an exception/i.test(
      clean
    )
  ) {
    return 'gradle';
  }
  return 'unknown';
}

export function detectFramework(content: string): JavaFramework {
  if (!content || typeof content !== 'string') {
    return 'general';
  }
  const clean = stripAnsi(content);
  if (/org\.springframework\.boot|spring-boot-starter|@SpringBootApplication/i.test(clean)) {
    return 'spring-boot';
  }
  if (/io\.quarkus|quarkus-resteasy|@QuarkusMain/i.test(clean)) {
    return 'quarkus';
  }
  return 'general';
}

export function parseJavaBuildLog(log: string): ParseResult {
  if (!log || typeof log !== 'string' || log.trim().length === 0) {
    return {
      tool: 'unknown',
      framework: 'general',
      totalErrors: 0,
      errors: [],
      isNetworkOrMirrorFailure: false,
      isJdkVersionIssue: false,
    };
  }

  // Strip ANSI color / terminal escape codes first
  const cleanLog = stripAnsi(log);
  const errors: JavaBuildError[] = [];
  const lines = cleanLog.split(/\r?\n/);
  const tool = detectBuildTool(cleanLog);
  const framework = detectFramework(cleanLog);

  let isNetworkOrMirrorFailure = false;
  let isJdkVersionIssue = false;

  // Regex patterns supporting Unix & Windows drive-letter paths, multiple [ERROR] tags, and leading whitespace
  // Leading [ERROR] prefixes are stripped via cleanLine to guarantee strictly linear O(N) parsing and zero ReDoS backtracking
  // Maven pattern: [ERROR] /path/to/App.java:[25,18] cannot find symbol
  // Windows:       [ERROR] C:\path\to\App.java:[25,18] cannot find symbol
  const mavenErrRegex = /^(?:([a-zA-Z]:[\\/][^:\[\r\n]*|[^:\[\r\n]+)):\[(\d+),(\d+)\]\s+(.*)$/;

  // Gradle pattern: /path/to/App.java:25: error: cannot find symbol
  // With column:    /path/to/App.java:25:18: error: cannot find symbol
  // Windows:        C:\path\to\App.java:25:32: error: cannot find symbol
  // Kotlin/Kapt:    e: /path/to/App.kt:25:18: Unresolved reference: foo
  const gradleErrRegex = /^\s*(?:e:\s+)?(.+?\.(?:java|kt|groovy|scala)):(\d+)(?::(\d+))?:\s+(?:error:\s+)?(.*)$/i;

  // Maven POM model error pattern:
  // [ERROR] 'dependencies.dependency.version' for com.foo:bar:jar is missing. @ line 45, column 17
  // [ERROR] Non-resolvable parent POM for ... @ /path/to/pom.xml, line 12, column 13
  const pomErrRegex = /^([^@\r\n]+?)\s*@\s*(?:([^\r\n,]+),\s*)?line\s+(\d+),\s*column\s+(\d+)/i;

  // Maven child module missing pattern:
  // [ERROR] Child module /path/to/sub/pom.xml of /path/to/parent/pom.xml does not exist
  const childModuleRegex = /^Child module\s+([^\r\n]+?)\s+of\s+([^\r\n]+?)\s+does not exist/i;

  for (let i = 0; i < lines.length; i++) {
    if (errors.length >= MAX_PARSED_ERRORS) {
      break;
    }

    const rawLine = lines[i];
    // Strip optional leading timestamps (e.g. CI logs like "2026-10-27T12:00:00.123 [ERROR] ...")
    const line = rawLine.replace(
      /^(?:\[?\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\]?|\[?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?)\s*/,
      ''
    );

    if (!line.trim()) {
      continue;
    }

    // Strip leading [ERROR] prefixes in O(N) linear time with no trailing backtrack token
    const cleanLine = line.replace(/^\s*(?:\[ERROR\]\s*)+/, '');

    // Check network / repository download failures (distinguish genuine network/mirror issue vs missing artifact)
    if (
      /Transfer failed for|Connection refused|PKIX path building failed|502 Bad Gateway|504 Gateway Timeout|401 Unauthorized|Server returned HTTP response code: 5|Network is unreachable|Connection timed out/i.test(
        line
      )
    ) {
      isNetworkOrMirrorFailure = true;
      errors.push({
        category: 'dependency_network_failure',
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          '检查 Maven settings.xml / build.gradle 仓库镜像（如阿里云镜像源 mirror）或企业私服网络连接与凭证。',
      });
      continue;
    }

    // Check JDK / compiler release version mismatch
    if (
      /Source option \d+ is no longer supported|release version \d+ not supported|invalid source release|Target release \d+ conflicts with|Unsupported class file major version|has been compiled by a more recent version of the Java Runtime/i.test(
        line
      )
    ) {
      isJdkVersionIssue = true;
      errors.push({
        category: 'jdk_version_mismatch',
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          '检查 pom.xml/build.gradle 中的 java.version / release / sourceCompatibility 是否与当前使用的 JDK 版本一致。',
      });
      continue;
    }

    // Check Maven POM processing errors (multi-module reactor)
    if (line.includes('@') && /line\s+\d+,\s*column\s+\d+/i.test(line)) {
      const pomMatch = cleanLine.match(pomErrRegex);
      if (pomMatch) {
        const [, errorMsg, filePath, lineStr, colStr] = pomMatch;
        let action = 'POM 解析错误：检查 pom.xml 中配置标签及依赖声明是否符合 Maven POM 规范。';
        if (/Non-resolvable parent POM/i.test(errorMsg)) {
          action =
            '检查 pom.xml 中的父 POM 坐标与 parent.relativePath 指向，确保父 POM 已安装至本地仓库或相对路径有效。';
        } else if (/dependencies\.dependency\.version.*missing/i.test(errorMsg)) {
          action =
            '依赖缺少版本号：在 pom.xml 中补充 <version>，或在父 POM <dependencyManagement> 中声明受管版本。';
        }

        errors.push({
          file: filePath ? filePath.trim() : 'pom.xml',
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          category: 'dependency_unresolved',
          message: errorMsg.trim(),
          raw: rawLine,
          suggestedAction: action,
        });
        continue;
      }
    }

    // Check Maven child module missing
    if (line.includes('Child module') && line.includes('does not exist')) {
      const childMatch = cleanLine.match(childModuleRegex);
      if (childMatch) {
        const [, childPath, parentPom] = childMatch;
        errors.push({
          file: parentPom.trim(),
          category: 'dependency_unresolved',
          symbol: childPath.trim(),
          message: line.trim(),
          raw: rawLine,
          suggestedAction:
            '父 POM <modules> 声明的子模块目录不存在，请检查子模块文件夹路径拼写或创建对应模块目录。',
        });
        continue;
      }
    }

    // Check Maven compiler error line
    if (cleanLine.includes(':[')) {
      const mavenMatch = cleanLine.match(mavenErrRegex);
      if (mavenMatch) {
        const [, file, lineStr, colStr, message] = mavenMatch;
        const parsed = classifyCompilerError(message, lines.slice(i, i + 6));
        errors.push({
          file: file.trim(),
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          category: parsed.category,
          symbol: parsed.symbol,
          message: message.trim(),
          raw: rawLine,
          suggestedAction: parsed.suggestedAction,
        });
        continue;
      }
    }

    // Check Gradle compiler error line
    const gradleMatch = line.match(gradleErrRegex);
    if (gradleMatch) {
      const [, file, lineStr, colStr, message] = gradleMatch;
      const parsed = classifyCompilerError(message, lines.slice(i, i + 6));
      errors.push({
        file: file.trim(),
        line: parseInt(lineStr, 10),
        column: colStr ? parseInt(colStr, 10) : undefined,
        category: parsed.category,
        symbol: parsed.symbol,
        message: message.trim(),
        raw: rawLine,
        suggestedAction: parsed.suggestedAction,
      });
      continue;
    }

    // Check Gradle unresolved dependency: "> Could not find com.foo:bar:1.0"
    const gradleFindMatch = line.match(/>\s*Could not find\s+([^\s:]+:[^\s:]+(?::[^\s:]+)?)/i);
    if (gradleFindMatch) {
      const artifact = gradleFindMatch[1].trim().replace(/[\.\s]+$/, '');
      errors.push({
        file: 'build.gradle',
        category: 'dependency_unresolved',
        symbol: artifact,
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          'Gradle 依赖项未找到，请核对 build.gradle 中的依赖坐标、版本号或 Maven 仓库声明。',
      });
      continue;
    }

    // Check Maven unresolved dependency (without network error)
    if (
      /Could not find artifact\s+([^\s]+)\s+in|Failure to find\s+([^\s]+)\s+in|The following artifacts could not be resolved:\s*([^\r\n]+)/i.test(
        line
      )
    ) {
      const artMatch =
        line.match(/Could not find artifact\s+([^\s]+)/i) ||
        line.match(/Failure to find\s+([^\s]+)/i) ||
        line.match(/The following artifacts could not be resolved:\s*([^\r\n]+)/i);
      const symbol = artMatch && artMatch[1] ? artMatch[1].trim().replace(/[\.\s]+$/, '') : undefined;
      errors.push({
        file: 'pom.xml',
        category: 'dependency_unresolved',
        symbol,
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          '依赖项在本地与远程仓库中均未找到。检查 groupId/artifactId/version 坐标拼写，或先运行 mvn install 构建前置依赖模块。',
      });
      continue;
    }

    // Check standalone MapStruct / annotation processor error lines
    if (/No implementation was created for|Internal error in the mapping processor|Can't generate mapping method/i.test(line)) {
      errors.push({
        category: 'mapstruct_issue',
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          '检查 MapStruct Mapper 接口字段映射配置。若结合 Lombok 使用，请确保编译器插件中 lombok 先于 mapstruct 声明，并引入 lombok-mapstruct-binding。',
      });
      continue;
    }

    // Check Checkstyle / SpotBugs plugin failures
    if (/Failed to execute goal.*maven-checkstyle-plugin|> Task :checkstyle.*FAILED|SpotBugs found \d+ violations/i.test(line)) {
      errors.push({
        category: 'checkstyle_spotbugs',
        message: line.trim(),
        raw: rawLine,
        suggestedAction: '代码规范或静态检查未通过，请检查 Checkstyle/SpotBugs 报错规则并调整代码格式。',
      });
      continue;
    }

    // Check standalone Jakarta EE 9+ / javax mismatch (without file location)
    if (/package javax\.(?:servlet|persistence|annotation|transaction)|import javax\.(?:servlet|persistence|annotation|transaction)/i.test(line)) {
      errors.push({
        category: 'jakarta_javax_mismatch',
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          'Spring Boot 3.x+ 已迁移至 Jakarta EE，请将 javax.* 替换为 jakarta.*（例如 jakarta.servlet.*, jakarta.persistence.*）。',
      });
      continue;
    }

    // Check JDK 17/21 strong encapsulation reflection error (InaccessibleObjectException)
    if (
      /InaccessibleObjectException|module\s+[\w\.]+\s+does not\s+"?opens?\s+[\w\.]+"?\s+to/i.test(cleanLine)
    ) {
      isJdkVersionIssue = true;
      const modMatch = cleanLine.match(/module\s+([\w\.]+)\s+does not\s+"?opens?\s+([\w\.]+)"?\s+to/i);
      const symbol = modMatch ? `${modMatch[1]}/${modMatch[2]}` : 'java.base/java.lang';
      errors.push({
        category: 'jdk_reflection_inaccessible',
        symbol,
        message: line.trim(),
        raw: rawLine,
        suggestedAction: `JDK 17/21 强封装反射异常（InaccessibleObjectException）：module ${modMatch ? modMatch[1] : 'java.base'} 未向未命名模块开放 ${modMatch ? modMatch[2] : 'java.lang'}。请在 pom.xml 的 maven-surefire-plugin 或 maven-compiler-plugin 中配置 <argLine>--add-opens ${symbol}=ALL-UNNAMED</argLine>；若为 Gradle，在 tasks.withType(Test) 中添加 jvmArgs('--add-opens', '${symbol}=ALL-UNNAMED')。`,
      });
      continue;
    }

    // Check Maven Enforcer plugin failures (BannedDependencies, DependencyConvergence)
    if (
      /Rule \d+:.*(?:BannedDependencies|DependencyConvergence)|Found Banned Dependency:|Dependency convergence error for/i.test(
        cleanLine
      )
    ) {
      let symbol: string | undefined;
      let action: string;
      const isBanned = /BannedDependenc|Found Banned Dependency/i.test(cleanLine);
      const isConvergence = /DependencyConvergence|Dependency convergence error/i.test(cleanLine);

      const bannedMatch = cleanLine.match(/Found Banned Dependency:\s*([^\s]+)/i);
      const convMatch = cleanLine.match(/Dependency convergence error for\s+([^\s]+)/i);

      if (bannedMatch) {
        symbol = cleanSymbol(bannedMatch[1]);
      } else if (convMatch) {
        symbol = cleanSymbol(convMatch[1]);
      } else {
        const ahead = lines.slice(i, i + 8).join('\n');
        const aheadBanned = ahead.match(/Found Banned Dependency:\s*([^\s]+)/i);
        const aheadConv = ahead.match(/Dependency convergence error for\s+([^\s]+)/i);
        if (aheadBanned) {
          symbol = cleanSymbol(aheadBanned[1]);
        } else if (aheadConv) {
          symbol = cleanSymbol(aheadConv[1]);
        }
      }

      if (isBanned || (!isConvergence && /Banned/i.test(cleanLine))) {
        action = `Maven Enforcer 规则校验失败（BannedDependencies）：检测到被禁止的依赖 ${symbol || '违规组件'}。请在引入它的直接依赖中配置 <exclusions> 排除该传递依赖（例如排除 commons-logging 改用 jcl-over-slf4j），或替换为合规依赖。`;
      } else if (isConvergence) {
        action = `Maven Enforcer 依赖收敛失败（DependencyConvergence）：依赖 ${symbol || '冲突组件'} 存在多版本冲突。请在父 POM 的 <dependencyManagement> 中显式锁定该依赖的版本号，强制全工程收敛统一版本。`;
      } else {
        action =
          'Maven Enforcer 规则检查失败：请根据具体规则在 pom.xml 中添加 <exclusions> 排除违规依赖，或在 <dependencyManagement> 中显式声明统一版本以满足依赖收敛。';
      }

      errors.push({
        file: 'pom.xml',
        category: 'enforcer_rule_failure',
        symbol,
        message: line.trim(),
        raw: rawLine,
        suggestedAction: action,
      });
      continue;
    }

    // Check MyBatis / MyBatis-Plus invalid bound statement (mapper XML missing in resources)
    if (
      /Invalid bound statement \(not found\)|No mapper XML found for mapper interface/i.test(
        cleanLine
      )
    ) {
      const boundMatch =
        cleanLine.match(/Invalid bound statement \(not found\):\s*([^\s\r\n\(\)]+)/i) ||
        cleanLine.match(/No mapper XML found for mapper interface:\s*([^\s\r\n\(\)]+)/i);
      const symbol = boundMatch ? cleanSymbol(boundMatch[1]) : undefined;

      let mapperFile = 'pom.xml';
      if (symbol) {
        const parts = symbol.split('.');
        if (parts.length > 1) {
          const className = parts[parts.length - 2];
          mapperFile = `${className}.xml`;
        }
      }

      errors.push({
        file: mapperFile,
        category: 'mybatis_mapper_missing',
        symbol,
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          'MyBatis / MyBatis-Plus Mapper 映射绑定失败（Invalid bound statement not found）：常见原因为 Mapper XML 位于 src/main/java 目录下但 Maven 默认未打包 XML 文件。请在 pom.xml <build><resources> 中显式添加资源包含：<resource><directory>src/main/java</directory><includes><include>**/*.xml</include></includes><filtering>false</filtering></resource>；或将 Mapper XML 移动至 src/main/resources/mapper/ 并在 application.yml 中配置 mybatis-plus.mapper-locations: classpath*:/mapper/**/*.xml。',
      });
      continue;
    }

    // Standalone encoding error line
    if (/unmappable character.*for encoding/i.test(cleanLine)) {
      const encMatch = cleanLine.match(/for encoding\s+([\w\-]+)/i);
      errors.push({
        category: 'encoding_error',
        symbol: encMatch ? encMatch[1].trim() : undefined,
        message: line.trim(),
        raw: rawLine,
        suggestedAction:
          '源码字符编码错误（Windows 环境常见）：请在 pom.xml <properties> 中显式配置 <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>，并在 maven-compiler-plugin 中指定 <encoding>UTF-8</encoding>；若为 Gradle，在 tasks.withType(JavaCompile) 中设置 options.encoding = "UTF-8"。',
      });
      continue;
    }
  }

  return {
    tool,
    framework,
    totalErrors: errors.length,
    errors,
    isNetworkOrMirrorFailure,
    isJdkVersionIssue,
  };
}

function cleanSymbol(sym?: string): string | undefined {
  if (!sym) return undefined;
  return sym.replace(/^[`'"]|[`'"]$/g, '').trim();
}

function classifyCompilerError(
  message: string,
  contextLines: string[]
): { category: ErrorCategory; symbol?: string; suggestedAction: string } {
  const context = contextLines.join('\n');

  // Jakarta / javax mismatch check in compiler error line
  if (
    /package javax\.(?:servlet|persistence|annotation|transaction)|import javax\.(?:servlet|persistence|annotation|transaction)/i.test(
      message
    ) ||
    /package javax\.(?:servlet|persistence|annotation|transaction)/i.test(context)
  ) {
    return {
      category: 'jakarta_javax_mismatch',
      suggestedAction:
        'Spring Boot 3.x+ 已迁移至 Jakarta EE，请将 javax.* 替换为 jakarta.*（例如 jakarta.servlet.*, jakarta.persistence.*）。',
    };
  }

  // Encoding error check in compiler error line
  if (/unmappable character/i.test(message) || /unmappable character/i.test(context)) {
    const encMatch = message.match(/for encoding\s+([\w\-]+)/i) || context.match(/for encoding\s+([\w\-]+)/i);
    const encoding = cleanSymbol(encMatch ? encMatch[1] : undefined);
    return {
      category: 'encoding_error',
      symbol: encoding,
      suggestedAction:
        '源码字符编码错误（Windows 环境常见）：请在 pom.xml <properties> 中显式配置 <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>，并在 maven-compiler-plugin 中指定 <encoding>UTF-8</encoding>；若为 Gradle，在 tasks.withType(JavaCompile) 中设置 options.encoding = "UTF-8"。',
    };
  }

  // MapStruct issue
  if (
    /mapping method|mapping processor|mapstruct|No implementation was created for|Unknown property [^\r\n]* in result type/i.test(
      message
    ) ||
    /mapstruct/i.test(context)
  ) {
    return {
      category: 'mapstruct_issue',
      suggestedAction:
        '检查 MapStruct Mapper 接口字段映射配置。若结合 Lombok 使用，请确保编译器插件中 lombok 先于 mapstruct 声明，并引入 lombok-mapstruct-binding。',
    };
  }

  // Cannot find symbol / Unresolved reference
  if (/cannot find symbol|unresolved reference/i.test(message)) {
    // Extract symbol: class X, variable Y, method Z(), constructor W
    const symbolMatch =
      context.match(/symbol:\s+(?:class|variable|method|constructor|interface)\s+([^\r\n\(\s]+)/i) ||
      message.match(/unresolved reference:\s*([^\r\n\(\s]+)/i) ||
      message.match(/cannot find symbol\s*[:\-]?\s*(?:class|variable|method)?\s*([^\r\n\(\s]+)?/i);

    const symbol = cleanSymbol(symbolMatch && symbolMatch[1] ? symbolMatch[1] : undefined);

    // Check if Lombok getter/setter/builder issue
    if (/^(?:get[A-Z]|set[A-Z]|is[A-Z]|builder$|build$|toBuilder$)/.test(symbol || '')) {
      return {
        category: 'lombok_issue',
        symbol,
        suggestedAction:
          '可能是 Lombok 注解处理器未启用或失效。检查 pom.xml 或 build.gradle 中编译器插件是否配置了 lombok annotation processor。',
      };
    }

    return {
      category: 'cannot_find_symbol',
      symbol,
      suggestedAction: symbol
        ? `确认是否缺失 import 或依赖：添加 import 或修复 ${symbol} 的拼写与作用域。`
        : '补充缺失的类/方法 import 或对应的依赖引入。',
    };
  }

  if (/package\s+([\w\.]+)\s+does not exist/i.test(message)) {
    const pkgMatch = message.match(/package\s+([\w\.]+)\s+does not exist/i);
    const pkg = cleanSymbol(pkgMatch ? pkgMatch[1] : undefined);

    if (pkg && /^javax\.(?:servlet|persistence|annotation|transaction)/.test(pkg)) {
      return {
        category: 'jakarta_javax_mismatch',
        symbol: pkg,
        suggestedAction:
          'Spring Boot 3.x+ 已迁移至 Jakarta EE，请将 javax.* 替换为 jakarta.*（例如 jakarta.servlet.*, jakarta.persistence.*）。',
      };
    }

    return {
      category: 'package_not_exist',
      symbol: pkg,
      suggestedAction: `在构建文件引入包含 ${pkg || '该包'} 的 dependency，并确认 scope 不是 test/provided。`,
    };
  }

  // Incompatible types: supports nested generics, Kotlin type mismatch, and bounds conflict
  if (/incompatible types|type mismatch/i.test(message) || /type mismatch/i.test(context)) {
    // Format 1: incompatible types: X cannot be converted to Y
    const convMatch = message.match(/incompatible types:\s*(.+?)\s+cannot be converted to\s+(.+)$/i);
    // Format 2: Kotlin: Type mismatch: inferred type is X but Y was expected
    const kotlinMatch = message.match(/inferred type is\s+(.+?)\s+but\s+(.+?)\s+was expected/i);
    // Format 3: Javac context lines: required: Y \n found: X
    const reqMatch = context.match(/required:\s*([^\r\n]+)/i);
    const foundMatch = context.match(/found:\s*([^\r\n]+)/i);

    let found: string | undefined;
    let required: string | undefined;

    if (convMatch) {
      found = cleanSymbol(convMatch[1]);
      required = cleanSymbol(convMatch[2]);
    } else if (kotlinMatch) {
      found = cleanSymbol(kotlinMatch[1]);
      required = cleanSymbol(kotlinMatch[2]);
    } else if (reqMatch && foundMatch) {
      required = cleanSymbol(reqMatch[1]);
      found = cleanSymbol(foundMatch[1]);
    }

    if (found && required) {
      return {
        category: 'incompatible_types',
        symbol: `${found} -> ${required}`,
        suggestedAction: `类型不匹配：期望类型 '${required}'，实际类型为 '${found}'。请核对变量/入参声明或方法返回类型，添加类型适配（如 map/collect 或类型强转），切勿盲目修改原有公共方法签名。`,
      };
    }

    // Check bounds conflict: "inference variable T has incompatible bounds"
    if (/incompatible bounds|equality constraints/i.test(message) || /incompatible bounds/i.test(context)) {
      return {
        category: 'incompatible_types',
        suggestedAction:
          '泛型推断类型边界约束冲突（incompatible bounds）。请在方法调用处显式指定泛型参数（例如 <TargetType>method()），或检查集合元素类型是否一致。',
      };
    }

    return {
      category: 'incompatible_types',
      suggestedAction: '类型不匹配。检查方法出参或变量声明，添加合法强转或类型适配转换。',
    };
  }

  if (/cannot be applied to given types|cannot find method[^\r\n]*with compatible parameters/i.test(message)) {
    return {
      category: 'method_not_applicable',
      suggestedAction: '入参类型或参数数量与重载方法不符，请核对方法签名入参。',
    };
  }

  if (/variable [^\r\n]+ might not have been initialized/i.test(message)) {
    return {
      category: 'uninitialized_variable',
      suggestedAction: '局部变量在使用前未初始化，赋予默认值或在所有分支完成赋值。',
    };
  }

  if (/non-static [^\r\n]+ cannot be referenced from a static context/i.test(message)) {
    return {
      category: 'static_context_violation',
      suggestedAction: '静态方法中引用了实例方法/字段。实例化对象调用或将目标方法设为 static。',
    };
  }

  if (/Annotation processor/i.test(message)) {
    return {
      category: 'annotation_processor_error',
      suggestedAction: '注解处理器（Lombok / MapStruct）配置冲突，核对 compiler-plugin 里的 processor 声明顺序。',
    };
  }

  return {
    category: 'unknown',
    suggestedAction: '查看具体报错位置上下文，执行最小改动修复。',
  };
}
