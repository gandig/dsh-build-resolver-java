import { ParseResult, BuildTool, JavaFramework } from './types.js';
export declare const MAX_PARSED_ERRORS = 100;
/**
 * Strips ANSI escape codes, OSC sequences, and CSI codes linearly without ReDoS risk.
 */
export declare function stripAnsi(text: string): string;
export declare function detectBuildTool(filesOrLog: string): BuildTool;
export declare function detectFramework(content: string): JavaFramework;
export declare function parseJavaBuildLog(log: string): ParseResult;
//# sourceMappingURL=parser.d.ts.map