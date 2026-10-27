/**
 * dsh-build-resolver-java
 *
 * Java / Maven / Gradle build and compiler error resolution plugin for DeepSeek Harness (DSH).
 * Provides surgical, minimal-diff fixes for build failures without refactoring.
 *
 * @module dsh-build-resolver-java
 */

import { parseJavaBuildLog, detectBuildTool, detectFramework, stripAnsi } from './parser.js';

export { parseJavaBuildLog, detectBuildTool, detectFramework, stripAnsi };

export const name = 'build-resolver-java';

// Optional Cordis injected services when running inside DSH runtime
export const inject = ['tools', 'systemPrompt'];

/**
 * Tool definitions exposed to the DeepSeek model
 */
export const tools = [
  {
    name: 'java_parse_build_errors',
    description:
      '解析 Maven 或 Gradle 的编译输出与构建日志，结构化提取具体报错文件、行号、列号、符号、错误分类及针对性外科手术式修复建议。',
    parameters: {
      type: 'object',
      properties: {
        buildLog: {
          type: 'string',
          description: '完整的 mvn 或 gradlew 编译/构建控制台输出日志文本。',
        },
      },
      required: ['buildLog'],
    },
    output: {
      schema: {
        type: 'string',
        description: '结构化 JSON 格式的解析结果，包含错误列表、构建工具与修复建议。',
      },
      render: (_args: unknown, value: unknown) => [
        {
          type: 'text' as const,
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
    },
    async execute({ buildLog }: { buildLog: string }) {
      const result = parseJavaBuildLog(buildLog);
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'java_inspect_project',
    description:
      '根据传入的 pom.xml 或 build.gradle 内容，诊断构建工具类型、主要框架（Spring Boot / Quarkus / 通用）及潜在的依赖和配置风险。',
    parameters: {
      type: 'object',
      properties: {
        buildFileContent: {
          type: 'string',
          description: 'pom.xml 或 build.gradle 的文件内容。',
        },
      },
      required: ['buildFileContent'],
    },
    output: {
      schema: {
        type: 'string',
        description: '诊断结果 JSON 字符串，包含构建工具类型与主要框架。',
      },
      render: (_args: unknown, value: unknown) => [
        {
          type: 'text' as const,
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        },
      ],
    },
    async execute({ buildFileContent }: { buildFileContent: string }) {
      const tool = detectBuildTool(buildFileContent);
      const framework = detectFramework(buildFileContent);
      const potentialRisks: string[] = [];

      // Check encoding declaration
      if (tool === 'maven' && !/<project\.build\.sourceEncoding>/i.test(buildFileContent)) {
        potentialRisks.push(
          'pom.xml 未显式声明 <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>，在 Windows 等非 UTF-8 平台构建时可能发生 unmappable character 编码错误。'
        );
      }

      // Check MyBatis / MyBatis-Plus resource packing
      if (/mybatis-spring-boot|mybatis-plus/i.test(buildFileContent)) {
        const hasXmlResource =
          /<include>[^<]*\*\.xml<\/include>/i.test(buildFileContent) &&
          /<directory>[^<]*src[\\\/]main[\\\/]java<\/directory>/i.test(buildFileContent);
        if (!hasXmlResource) {
          potentialRisks.push(
            '检测到 MyBatis/MyBatis-Plus 依赖：若 Mapper XML 置于 src/main/java 下，需确保 pom.xml <build><resources> 配置了 **/*.xml 包含，避免运行时 Invalid bound statement (not found)。'
          );
        }
      }

      // Check Maven Enforcer plugin
      if (/maven-enforcer-plugin/i.test(buildFileContent)) {
        potentialRisks.push(
          '项目启用了 maven-enforcer-plugin，注意依赖收敛 (DependencyConvergence) 与禁用依赖 (BannedDependencies) 规则。'
        );
      }

      // Check JDK 17+ reflection
      if (/java\.version>17|java\.version>21|release>17|release>21|sourceCompatibility\s*=\s*['"]?17/i.test(buildFileContent)) {
        potentialRisks.push(
          '项目使用 JDK 17/21 运行环境，若涉及深度反射调用需在 maven-surefire-plugin 中配置 --add-opens 参数。'
        );
      }

      return JSON.stringify(
        potentialRisks.length > 0 ? { tool, framework, potentialRisks } : { tool, framework },
        null,
        2
      );
    },
  },
];

/**
 * System prompt injection for DeepSeek agent
 */
export const systemPrompt = `
# Java Build Resolver Engineering Discipline (Strict Constraints)

When Java / Maven / Gradle build failures occur, you MUST adhere to the following rules:

1. **Surgical Fixes Only (Zero Refactoring)**:
   - Fix ONLY the compile/build error.
   - NEVER refactor, reorganize, or rewrite working business logic.
   - NEVER change method signatures or API contracts unless the compile error is directly caused by a signature mismatch.
   - NEVER introduce dummy or stub implementations (e.g. returning null/mock objects) just to pass compilation.
   - Read ONLY the immediate lines around the error (±15 lines), never read or rewrite entire files.

2. **Error Expansion Circuit Breaker**:
   - Every single modification must reduce or maintain the compiler error count.
   - If a change causes the error count to increase or introduces new errors in other files, IMMEDIATELY revert that change (\`git checkout -- <file>\`).

3. **Three-Strike Circuit Breaker**:
   - If the same error cannot be resolved within 3 attempts, STOP immediately.
   - Output a root cause analysis report explaining the failure and request user guidance.

4. **Framework & Environment Rules**:
   - Spring Boot 3.x+: Must use \`jakarta.*\` (e.g., \`jakarta.servlet.*\`, \`jakarta.persistence.*\`), NEVER \`javax.*\`.
   - Lombok & MapStruct: In \`annotationProcessorPaths\`, \`lombok\` MUST precede \`mapstruct-processor\`, and \`lombok-mapstruct-binding\` must be included.
   - Scope Protection: Check if missing symbols are caused by dependencies scoped to \`<scope>test</scope>\` or \`<scope>provided</scope>\`.
   - Never suppress warnings blindly: Do not add \`@SuppressWarnings\` without explicit user permission.

5. **Chinese Enterprise High-Frequency Pitfalls (中国企业级暗坑规避)**:
   - **Source Encoding (源码编码)**: Always ensure \`<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\` is present in pom.xml properties to avoid Windows GBK \`unmappable character\` errors.
   - **JDK 17/21 Reflection (强封装反射)**: When encountering \`InaccessibleObjectException: module java.base does not opens java.lang to unnamed module\`, configure \`<argLine>--add-opens java.base/java.lang=ALL-UNNAMED</argLine>\` in maven-surefire-plugin (or compiler plugin), NEVER attempt to modify JDK modules or use sun.misc.Unsafe.
   - **Maven Enforcer (依赖收敛与禁令)**:
     - \`BannedDependencies\`: Add \`<exclusions>\` to the offending dependency (e.g. exclude commons-logging in favor of jcl-over-slf4j), or swap for the approved library.
     - \`DependencyConvergence\`: Lock the conflicting artifact version explicitly in parent POM \`<dependencyManagement>\`.
   - **MyBatis / MyBatis-Plus XML Resources (资源打包漏打)**:
     - \`Invalid bound statement (not found)\`: Maven by default only copies src/main/resources. If Mapper XML files reside under src/main/java, surgical fix is adding \`<resource><directory>src/main/java</directory><includes><include>**/*.xml</include></includes><filtering>false</filtering></resource>\` under \`<build><resources>\`, OR moving XMLs to src/main/resources/mapper/ and setting \`mybatis-plus.mapper-locations: classpath*:/mapper/**/*.xml\`.
`;

export function apply(ctx: any) {
  if (ctx && ctx.tools) {
    for (const tool of tools) {
      if (typeof ctx.tools.register === 'function') {
        try {
          ctx.tools.register(tool);
        } catch {
          // Safe fallback if host tool registry expects an alternative signature
        }
      }
    }
  }

  if (ctx && ctx.systemPrompt) {
    if (typeof ctx.systemPrompt.section === 'function') {
      try {
        const order =
          typeof ctx.systemPrompt.getSectionOrder === 'function'
            ? ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 10
            : 10000;
        ctx.systemPrompt.section({
          name: 'java-build-resolver',
          text: systemPrompt,
          order: Number.isFinite(order) ? order : 10000,
        });
      } catch {
        // Safe fallback
      }
    } else if (typeof ctx.systemPrompt.append === 'function') {
      ctx.systemPrompt.append(systemPrompt);
    }
  }
}

export default apply;
