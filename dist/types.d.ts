export type JavaFramework = 'spring-boot' | 'quarkus' | 'general';
export type BuildTool = 'maven' | 'gradle' | 'unknown';
export type ErrorSeverity = 'error' | 'warning';
export type ErrorCategory = 'cannot_find_symbol' | 'package_not_exist' | 'incompatible_types' | 'method_not_applicable' | 'uninitialized_variable' | 'static_context_violation' | 'annotation_processor_error' | 'lombok_issue' | 'mapstruct_issue' | 'dependency_unresolved' | 'dependency_network_failure' | 'jdk_version_mismatch' | 'jdk_reflection_inaccessible' | 'jakarta_javax_mismatch' | 'encoding_error' | 'enforcer_rule_failure' | 'mybatis_mapper_missing' | 'checkstyle_spotbugs' | 'unknown';
export interface JavaBuildError {
    file?: string;
    line?: number;
    column?: number;
    category: ErrorCategory;
    symbol?: string;
    message: string;
    raw: string;
    suggestedAction?: string;
}
export interface ParseResult {
    tool: BuildTool;
    framework: JavaFramework;
    totalErrors: number;
    errors: JavaBuildError[];
    isNetworkOrMirrorFailure: boolean;
    isJdkVersionIssue: boolean;
    truncated: boolean;
}
//# sourceMappingURL=types.d.ts.map