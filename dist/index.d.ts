/**
 * dsh-build-resolver-java
 *
 * Java / Maven / Gradle build and compiler error resolution plugin for DeepSeek Harness (DSH).
 * Provides surgical, minimal-diff fixes for build failures without refactoring.
 *
 * @module dsh-build-resolver-java
 */
export declare const name = "build-resolver-java";
export declare const inject: string[];
/**
 * System prompt injection for DeepSeek agent
 */
export declare const systemPrompt = "\n# Java Build Resolver Guideline\n\nWhen Java / Maven / Gradle build failures occur:\n1. **Surgical Fixes Only**: Never refactor or rewrite business logic. Fix ONLY the compile error.\n2. **Never Suppress Blindly**: Never add @SuppressWarnings without explicit rationale.\n3. **Check Framework & JDK**:\n   - If Spring Boot 3+, ensure javax.servlet / javax.persistence are migrated to jakarta.*\n   - If Lombok getter/setter cannot be found, check annotationProcessorPaths in maven-compiler-plugin.\n4. **Three-Strike Rule**: If the same error cannot be resolved in 3 attempts, STOP and report the root cause.\n5. **Chinese Enterprise Pitfalls**:\n   - For unmappable character errors on Windows, configure UTF-8 in <project.build.sourceEncoding>.\n   - For JDK 17/21 InaccessibleObjectException, add @{argLine} --add-opens java.base/package=ALL-UNNAMED.\n   - For Maven Enforcer rules, exclude banned dependencies or lock versions in <dependencyManagement>.\n";
/**
 * Tool definitions exposed to the DeepSeek model
 */
export declare const tools: ({
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            buildLog: {
                type: string;
                description: string;
            };
            buildFileContent?: undefined;
        };
        required: string[];
    };
    output: {
        schema: {
            type: string;
            description: string;
        };
        render: (_args: any, value: string) => {
            type: "text";
            text: string;
        }[];
    };
    execute({ buildLog }: {
        buildLog: string;
    }): Promise<string>;
} | {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            buildFileContent: {
                type: string;
                description: string;
            };
            buildLog?: undefined;
        };
        required: string[];
    };
    output: {
        schema: {
            type: string;
            description: string;
        };
        render: (_args: any, value: string) => {
            type: "text";
            text: string;
        }[];
    };
    execute({ buildFileContent }: {
        buildFileContent: string;
    }): Promise<string>;
})[];
/**
 * Cordis plugin apply function
 * Note: Must NOT export default apply to prevent Cordis loader from dropping the inject namespace!
 */
export declare function apply(ctx: any): void;
//# sourceMappingURL=index.d.ts.map