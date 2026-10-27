/**
 * dsh-build-resolver-java
 *
 * Java / Maven / Gradle build and compiler error resolution plugin for DeepSeek Harness (DSH).
 * Provides surgical, minimal-diff fixes for build failures without refactoring.
 *
 * @module dsh-build-resolver-java
 */

import { readFileSync } from 'node:fs';
import { parseJavaBuildLog, detectBuildTool, detectFramework } from './parser.js';

export const name = 'build-resolver-java';

// Declared DSH/Cordis injected services
export const inject = ['tools', 'systemPrompt', 'skills'];

/**
 * System prompt injection for DeepSeek agent
 */
export const systemPrompt = `
# Java Build Resolver Guideline

When Java / Maven / Gradle build failures occur:
1. **Surgical Fixes Only**: Never refactor or rewrite business logic. Fix ONLY the compile error.
2. **Never Suppress Blindly**: Never add @SuppressWarnings without explicit rationale.
3. **Check Framework & JDK**:
   - If Spring Boot 3+, ensure javax.servlet / javax.persistence are migrated to jakarta.*
   - If Lombok getter/setter cannot be found, check annotationProcessorPaths in maven-compiler-plugin.
4. **Three-Strike Rule**: If the same error cannot be resolved in 3 attempts, STOP and report the root cause.
5. **Chinese Enterprise Pitfalls**:
   - For unmappable character errors on Windows, configure UTF-8 in <project.build.sourceEncoding>.
   - For JDK 17/21 InaccessibleObjectException, add @{argLine} --add-opens java.base/package=ALL-UNNAMED.
   - For Maven Enforcer rules, exclude banned dependencies or lock versions in <dependencyManagement>.
`;

/**
 * Tool definitions exposed to the DeepSeek model
 */
export const tools = [
  {
    name: 'java_parse_build_errors',
    description:
      '解析 Maven 或 Gradle 的编译输出与构建日志，结构化提取具体报错文件、行号、符号、错误分类及针对性外科手术式修复建议。',
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
        description: 'JSON formatted ParseResult object',
      },
      render: (_args: any, value: string) => [
        {
          type: 'text' as const,
          text: value,
        },
      ],
    },
    async execute({ buildLog }: { buildLog: string }) {
      if (typeof buildLog !== 'string' || !buildLog.trim()) {
        throw new Error('INVALID_ARGS: "buildLog" must be a non-empty string');
      }
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
        description: 'JSON formatted inspection result',
      },
      render: (_args: any, value: string) => [
        {
          type: 'text' as const,
          text: value,
        },
      ],
    },
    async execute({ buildFileContent }: { buildFileContent: string }) {
      if (typeof buildFileContent !== 'string' || !buildFileContent.trim()) {
        throw new Error('INVALID_ARGS: "buildFileContent" must be a non-empty string');
      }
      const tool = detectBuildTool(buildFileContent);
      const framework = detectFramework(buildFileContent);

      const inspection: {
        tool: string;
        framework: string;
        detectedRisks: string[];
      } = {
        tool,
        framework,
        detectedRisks: [],
      };

      if (tool === 'maven') {
        if (!/project\.build\.sourceEncoding/i.test(buildFileContent)) {
          inspection.detectedRisks.push('未显式配置 project.build.sourceEncoding UTF-8，在不同系统下可能引发编码异常。');
        }
        if (/mybatis/i.test(buildFileContent) && !/<include>.*\.xml<\/include>/i.test(buildFileContent)) {
          inspection.detectedRisks.push('引入了 MyBatis 但未在 resources 中包含 XML 映射文件，可能导致运行时 BindingException。');
        }
      }

      return JSON.stringify(inspection, null, 2);
    },
  },
];

/**
 * Cordis plugin apply function
 * Note: Must NOT export default apply to prevent Cordis loader from dropping the inject namespace!
 */
export function apply(ctx: any) {
  // 1. Register tools with ctx.effect lifecycle
  for (const tool of tools) {
    if (ctx.tools && typeof ctx.tools.register === 'function') {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => ctx.tools.register(tool), `build-resolver-java.tool(${tool.name})`);
      } else {
        ctx.tools.register(tool);
      }
    }
  }

  // 2. Register system prompt section with ctx.effect lifecycle
  if (ctx.systemPrompt) {
    if (typeof ctx.systemPrompt.section === 'function') {
      const sectionEntry = {
        name: 'java-build-resolver',
        order: 10190,
        content: () => systemPrompt,
      };
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => ctx.systemPrompt.section(sectionEntry), 'build-resolver-java.systemPrompt()');
      } else {
        ctx.systemPrompt.section(sectionEntry);
      }
    } else if (typeof ctx.systemPrompt.append === 'function') {
      ctx.systemPrompt.append(systemPrompt);
    }
  }

  // 3. Register skill via official ctx.skills.register
  if (ctx.skills && typeof ctx.skills.register === 'function') {
    try {
      const skillPath = new URL('../skills/java-build-resolver/SKILL.md', import.meta.url);
      const skillContent = readFileSync(skillPath, 'utf8');
      const skillEntry = {
        name: 'java-build-resolver',
        description: 'Surgical resolver for Java, Maven, and Gradle build, compilation, and dependency errors.',
        content: skillContent,
      };
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => ctx.skills.register(skillEntry), 'build-resolver-java.skill()');
      } else {
        ctx.skills.register(skillEntry);
      }
    } catch (_err) {
      // In minimal test environments where skills/ is not located relative to dist, skip gracefully
    }
  }
}
