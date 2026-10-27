export const MAX_PARSED_ERRORS = 100;
/**
 * Strips ANSI escape codes, OSC sequences, and CSI codes linearly without ReDoS risk.
 */
export function stripAnsi(text) {
    if (!text)
        return '';
    return text
        // Strip OSC sequences: \x1b] ... (\x07 | \x1b\\)
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        // Strip CSI sequences: \x1b[ ... [a-zA-Z]
        .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g, '')
        // Strip raw trailing escape character
        .replace(/\x1b/g, '');
}
/**
 * Normalizes input lines: strips ANSI and CI timestamps.
 */
function cleanLineText(rawLine) {
    let line = stripAnsi(rawLine);
    // Strip CI/CD timestamps: e.g., 2026-10-27T12:00:00.123 [ERROR] or [14:23:05]
    line = line.replace(/^\s*(?:\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\]|\d{4}-\d{2}-\d{2}T[^\s]+)\s+/, '');
    return line;
}
export function detectBuildTool(filesOrLog) {
    if (!filesOrLog || typeof filesOrLog !== 'string')
        return 'unknown';
    const clean = stripAnsi(filesOrLog);
    if (/pom\.xml/i.test(clean) ||
        /\[INFO\] Scanning for projects/i.test(clean) ||
        /<project\b[^>]*>/i.test(clean) ||
        /<modelVersion>/i.test(clean)) {
        return 'maven';
    }
    if (/build\.gradle/i.test(clean) ||
        /> Task\s+:[^\r\n]*FAILED/i.test(clean) ||
        /\bplugins\s*\{/i.test(clean) ||
        /\bdependencies\s*\{/i.test(clean) ||
        /\bapply\s+plugin:/i.test(clean)) {
        return 'gradle';
    }
    return 'unknown';
}
export function detectFramework(content) {
    if (!content || typeof content !== 'string')
        return 'general';
    const clean = stripAnsi(content);
    if (/org\.springframework\.boot|spring-boot-starter|@SpringBootApplication/i.test(clean)) {
        return 'spring-boot';
    }
    if (/io\.quarkus|quarkus-resteasy|@QuarkusMain/i.test(clean)) {
        return 'quarkus';
    }
    return 'general';
}
export function parseJavaBuildLog(log) {
    if (!log || typeof log !== 'string' || !log.trim()) {
        return {
            tool: 'unknown',
            framework: 'general',
            totalErrors: 0,
            errors: [],
            isNetworkOrMirrorFailure: false,
            isJdkVersionIssue: false,
            truncated: false,
        };
    }
    const errors = [];
    const rawLines = log.split(/\r?\n/);
    const tool = detectBuildTool(log);
    const framework = detectFramework(log);
    let isNetworkOrMirrorFailure = false;
    let isJdkVersionIssue = false;
    let truncated = false;
    // Regex patterns
    // Maven compiler error: [ERROR] /path/to/App.java:[25,18] cannot find symbol
    const mavenErrRegex = /^(?:([a-zA-Z]:[\\/][^:\[\r\n]*|[^:\[\r\n]+)):\[(\d+),(\d+)\]\s+(.*)$/;
    // Gradle compiler error: /path/to/App.java:25: error: cannot find symbol OR /path/to/App.java:25:10: error:
    const gradleErrRegex = /^(?:e:\s+)?(.+?\.(?:java|kt|groovy|scala)):(\d+)(?::(\d+))?:\s+error:\s+(.*)$/;
    // Maven POM reactor failure
    const pomErrRegex = /^([^@\r\n]+?)\s*@\s*(?:([^\r\n,]+),\s*)?line\s+(\d+),\s*column\s+(\d+)/;
    const childModuleRegex = /^Child module\s+([^\s]+)\s+of\s+([^\s]+)\s+does not exist/i;
    let hasExplicitFailureSign = false;
    let generalFailureMessage = '';
    for (let i = 0; i < rawLines.length; i++) {
        if (errors.length >= MAX_PARSED_ERRORS) {
            truncated = true;
            break;
        }
        const rawLine = rawLines[i];
        const cleanLine = cleanLineText(rawLine);
        const lineWithoutPrefix = cleanLine.replace(/^\s*(?:\[ERROR\]\s*)+/, '');
        // Check high-level failure banner
        if (/\bBUILD FAILURE\b|\bCOMPILATION ERROR\b|Execution failed for task\b|Failed to execute goal\b/i.test(cleanLine)) {
            hasExplicitFailureSign = true;
            if (!generalFailureMessage && (/BUILD FAILURE|COMPILATION ERROR|Failed to execute/i.test(cleanLine))) {
                generalFailureMessage = cleanLine.trim();
            }
        }
        // 1. Network / Repository download failures (broad check)
        if (/Could not resolve dependencies|Transfer failed for|Connection refused|Connection reset|PKIX path building failed|UnknownHostException|handshake_failure|502 Bad Gateway|status code 502|403 Forbidden|401 Unauthorized/i.test(cleanLine)) {
            isNetworkOrMirrorFailure = true;
            errors.push({
                category: 'dependency_network_failure',
                message: cleanLine.trim(),
                raw: rawLine,
                suggestedAction: '检查 ~/.m2/settings.xml 中的仓库镜像配置（如配置阿里云 public 镜像源），或检查企业私服网络连接、VPN 及凭证。',
            });
            continue;
        }
        // 2. JDK version & compiler release issues
        if (/Source option \d+ is no longer supported|release version \d+ not supported|invalid source release|Target release \d+ conflicts with|Unsupported class file major version \d+/i.test(cleanLine)) {
            isJdkVersionIssue = true;
            errors.push({
                category: 'jdk_version_mismatch',
                message: cleanLine.trim(),
                raw: rawLine,
                suggestedAction: '检查 pom.xml 或 build.gradle 中的 java.version / release / sourceCompatibility 是否与编译运行使用的本地 JDK 版本一致。',
            });
            continue;
        }
        // 3. JDK 17/21 InaccessibleObjectException (Strong encapsulation)
        if (/InaccessibleObjectException.*module java\.base does not "opens /i.test(cleanLine)) {
            isJdkVersionIssue = true;
            const moduleMatch = cleanLine.match(/opens\s+([a-zA-Z0-9_.]+)\s+to/i);
            const targetPackage = moduleMatch ? moduleMatch[1] : 'java.lang';
            errors.push({
                category: 'jdk_reflection_inaccessible',
                symbol: `java.base/${targetPackage}`,
                message: cleanLine.trim(),
                raw: rawLine,
                suggestedAction: `在 surefire/failsafe 插件的 <argLine> 中添加: @{argLine} --add-opens java.base/${targetPackage}=ALL-UNNAMED`,
            });
            continue;
        }
        // 4. Maven Enforcer Rule Failure
        if (/Rule \d+:\s+org\.apache\.maven\.enforcer\.rules\./i.test(cleanLine)) {
            const isBanned = /BannedDependencies/i.test(cleanLine);
            const isConvergence = /DependencyConvergence/i.test(cleanLine);
            errors.push({
                file: 'pom.xml',
                category: 'enforcer_rule_failure',
                symbol: isBanned ? 'BannedDependencies' : isConvergence ? 'DependencyConvergence' : 'EnforcerRule',
                message: cleanLine.trim(),
                raw: rawLine,
                suggestedAction: isBanned
                    ? '在引入禁用依赖的直接 dependency 中添加 <exclusions> 排除该传递依赖。'
                    : '在父 POM 的 <dependencyManagement> 中统一锁定该冲突依赖的精确版本。',
            });
            continue;
        }
        // 5. MyBatis Missing XML / Invalid Bound Statement
        if (/BindingException:\s*Invalid bound statement \(not found\):\s*([^\s]+)/i.test(cleanLine)) {
            const match = cleanLine.match(/BindingException:\s*Invalid bound statement \(not found\):\s*([^\s]+)/i);
            const fullMethod = match ? match[1] : '';
            errors.push({
                category: 'mybatis_mapper_missing',
                symbol: fullMethod,
                message: cleanLine.trim(),
                raw: rawLine,
                suggestedAction: '检查 pom.xml 中的 <build><resources> 是否包含了 src/main/java 下的 **/*.xml，或将 XML 移至 src/main/resources/mapper/。',
            });
            continue;
        }
        // 6. Maven POM Reactor issues
        if (cleanLine.includes('@') && cleanLine.includes('line') && cleanLine.includes('column')) {
            const pomMatch = lineWithoutPrefix.match(pomErrRegex);
            if (pomMatch) {
                const [, msg, pomPath, lineStr, colStr] = pomMatch;
                errors.push({
                    file: pomPath ? pomPath.trim() : 'pom.xml',
                    line: parseInt(lineStr, 10),
                    column: parseInt(colStr, 10),
                    category: 'dependency_unresolved',
                    message: msg.trim(),
                    raw: rawLine,
                    suggestedAction: '检查该 pom.xml 的对应行号，补充缺失的 parent / dependency version 或调整坐标配置。',
                });
                continue;
            }
        }
        // 7. Missing child module
        if (cleanLine.includes('Child module') && cleanLine.includes('does not exist')) {
            const childMatch = lineWithoutPrefix.match(childModuleRegex);
            if (childMatch) {
                const [, child, parent] = childMatch;
                errors.push({
                    file: parent ? `${parent}/pom.xml` : 'pom.xml',
                    category: 'dependency_unresolved',
                    symbol: child,
                    message: cleanLine.trim(),
                    raw: rawLine,
                    suggestedAction: `检查 ${parent} 的 <modules> 配置，子模块目录 ${child} 缺失或拼写错误。`,
                });
                continue;
            }
        }
        // 8. Maven Compiler Error Line
        if (lineWithoutPrefix.includes(':[')) {
            const mavenMatch = lineWithoutPrefix.match(mavenErrRegex);
            if (mavenMatch) {
                const [, file, lineStr, colStr, message] = mavenMatch;
                const continuation = collectContinuationLines(rawLines, i);
                const parsed = classifyCompilerError(message, continuation);
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
        // 9. Gradle Compiler Error Line
        if (cleanLine.includes(': error:') || cleanLine.startsWith('e: ')) {
            const gradleMatch = cleanLine.match(gradleErrRegex);
            if (gradleMatch) {
                const [, file, lineStr, colStr, message] = gradleMatch;
                const continuation = collectContinuationLines(rawLines, i);
                const parsed = classifyCompilerError(message, continuation);
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
        }
        // 10. Checkstyle / SpotBugs violations
        if (/\[ERROR\].*checkstyle|\[ERROR\].*spotbugs/i.test(cleanLine)) {
            errors.push({
                category: 'checkstyle_spotbugs',
                message: cleanLine.trim(),
                raw: rawLine,
                suggestedAction: '代码风格或静态分析检查失败，根据插件报告修正违规项或在特定方法上做针对性注释。',
            });
            continue;
        }
    }
    // Fallback Catch-all: If build definitely failed but no specific error was captured
    if (errors.length === 0 && hasExplicitFailureSign) {
        errors.push({
            category: 'unknown',
            message: generalFailureMessage || '构建失败，但日志中未识别出已知格式的编译器报错行。',
            raw: generalFailureMessage || 'BUILD FAILURE',
            suggestedAction: '请提供完整的 mvn/gradle 构建控制台输出（带 -X 或 --stacktrace），以便定位确切原因。',
        });
    }
    return {
        tool,
        framework,
        totalErrors: errors.length,
        errors,
        isNetworkOrMirrorFailure,
        isJdkVersionIssue,
        truncated,
    };
}
/**
 * Collects ONLY the continuation lines that belong to the current error.
 * Stops immediately when encountering a new error, empty line, or next log entry.
 */
function collectContinuationLines(lines, currentIndex) {
    const result = [];
    for (let j = currentIndex + 1; j < Math.min(lines.length, currentIndex + 6); j++) {
        const raw = lines[j];
        const clean = cleanLineText(raw);
        const withoutPrefix = clean.replace(/^\s*(?:\[ERROR\]\s*)+/, '').trim();
        // If next line starts a new compiler error, stop immediately!
        if (withoutPrefix.includes(':[') ||
            withoutPrefix.includes(': error:') ||
            clean.includes(': error:') ||
            withoutPrefix.startsWith('e: ')) {
            break;
        }
        // If it's a known continuation line (e.g., symbol:, location:, required:, found:)
        if (withoutPrefix.startsWith('symbol:') ||
            withoutPrefix.startsWith('location:') ||
            withoutPrefix.startsWith('required:') ||
            withoutPrefix.startsWith('found:')) {
            result.push(withoutPrefix);
        }
        else {
            // Stop collecting if it's not a recognized continuation
            break;
        }
    }
    return result;
}
function classifyCompilerError(message, continuationLines) {
    // 1. Jakarta EE 9+ / javax mismatch (ONLY from the message itself to prevent bleed)
    if (/package javax\.servlet|package javax\.persistence|package javax\.annotation\.Resource/i.test(message)) {
        return {
            category: 'jakarta_javax_mismatch',
            suggestedAction: 'Spring Boot 3.x+ 已迁移至 Jakarta EE，将 javax.servlet / javax.persistence 等规范包替换为 jakarta.*。注意不要误替换 javax.annotation.processing 等 JSR 规范包。',
        };
    }
    // 2. Encoding errors (ONLY from the message itself)
    if (/unmappable character.*for encoding/i.test(message)) {
        const encMatch = message.match(/for encoding\s+([a-zA-Z0-9_\-]+)/i);
        const enc = encMatch ? encMatch[1] : undefined;
        return {
            category: 'encoding_error',
            symbol: enc,
            suggestedAction: '源码包含非当前编码字符。在 pom.xml 的 <properties> 中声明 <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding> 并配置 maven-compiler-plugin 编码。',
        };
    }
    // 3. Cannot find symbol
    if (/cannot find symbol/i.test(message)) {
        // Extract symbol exclusively from continuation lines
        let symbol;
        for (const line of continuationLines) {
            const symbolMatch = line.match(/^symbol:\s+(?:class|variable|method|constructor)\s+([a-zA-Z0-9_]+)/i);
            if (symbolMatch) {
                symbol = symbolMatch[1];
                break;
            }
        }
        if (symbol && /^(?:get[A-Z]|set[A-Z]|is[A-Z]|builder$|build$)/.test(symbol)) {
            return {
                category: 'lombok_issue',
                symbol,
                suggestedAction: 'Lombok 生成的方法找不到。检查 pom.xml 中 maven-compiler-plugin 是否配置了 lombok 的 annotationProcessorPaths。',
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
    // 4. Package does not exist
    if (/package\s+([\w\.]+)\s+does not exist/i.test(message)) {
        const pkgMatch = message.match(/package\s+([\w\.]+)\s+does not exist/i);
        const pkg = pkgMatch ? pkgMatch[1] : undefined;
        if (pkg && pkg.startsWith('javax.servlet')) {
            return {
                category: 'jakarta_javax_mismatch',
                symbol: pkg,
                suggestedAction: 'Spring Boot 3.x 已废弃 javax.servlet，请迁移为 jakarta.servlet。',
            };
        }
        return {
            category: 'package_not_exist',
            symbol: pkg,
            suggestedAction: `在构建文件引入包含 ${pkg || '该包'} 的 dependency，并确认 scope 不是 test/provided。`,
        };
    }
    // 5. Incompatible types
    if (/incompatible types/i.test(message)) {
        let req;
        let found;
        for (const line of continuationLines) {
            if (line.startsWith('required:'))
                req = line.replace('required:', '').trim();
            if (line.startsWith('found:'))
                found = line.replace('found:', '').trim();
        }
        const typePair = req && found ? `${found} -> ${req}` : undefined;
        return {
            category: 'incompatible_types',
            symbol: typePair,
            suggestedAction: typePair
                ? `类型不匹配（实际: ${found}，要求: ${req}）。添加合法类型转换或适配返回值。`
                : '类型不匹配。检查方法出参或变量声明，添加合法强转或类型适配转换。',
        };
    }
    // 6. Method cannot be applied
    if (/cannot be applied to given types/i.test(message)) {
        return {
            category: 'method_not_applicable',
            suggestedAction: '入参类型或参数数量与重载方法不符，请核对方法签名入参。',
        };
    }
    // 7. Uninitialized variable
    if (/variable .* might not have been initialized/i.test(message)) {
        return {
            category: 'uninitialized_variable',
            suggestedAction: '局部变量在使用前未初始化，赋予默认值或在所有分支完成赋值。',
        };
    }
    // 8. Static context violation
    if (/non-static method .* cannot be referenced from a static context/i.test(message)) {
        return {
            category: 'static_context_violation',
            suggestedAction: '静态方法中引用了实例方法/字段。实例化对象调用或将目标方法设为 static。',
        };
    }
    // 9. Annotation processor error
    if (/Annotation processor/i.test(message)) {
        return {
            category: 'annotation_processor_error',
            suggestedAction: '注解处理器配置冲突，核对 compiler-plugin 里的 processor 声明顺序（如 Lombok 必须在 MapStruct 前）。',
        };
    }
    return {
        category: 'unknown',
        suggestedAction: '查看具体报错位置上下文，执行最小改动修复。',
    };
}
//# sourceMappingURL=parser.js.map