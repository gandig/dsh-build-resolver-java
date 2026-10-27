import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseJavaBuildLog, detectBuildTool, detectFramework, stripAnsi } from '../dist/parser.js';
import { tools, apply, name, inject, systemPrompt } from '../dist/index.js';

test('detectBuildTool should recognize maven, gradle, and unknown variants', () => {
  assert.equal(detectBuildTool('pom.xml exists in directory'), 'maven');
  assert.equal(detectBuildTool('[INFO] Scanning for projects...'), 'maven');
  assert.equal(detectBuildTool('mvnw compile -q'), 'maven');
  assert.equal(detectBuildTool('dependencies in build.gradle'), 'gradle');
  assert.equal(detectBuildTool('plugins in build.gradle.kts'), 'gradle');
  assert.equal(detectBuildTool('Execution failed: > Task :compileJava FAILED'), 'gradle');
  assert.equal(detectBuildTool('BUILD FAILED in 3s'), 'gradle');
  assert.equal(detectBuildTool('npm run build error'), 'unknown');
  assert.equal(detectBuildTool(''), 'unknown');
  assert.equal(detectBuildTool(null as unknown as string), 'unknown');
});

test('detectFramework should recognize spring-boot, quarkus, and general', () => {
  assert.equal(detectFramework('<groupId>org.springframework.boot</groupId>'), 'spring-boot');
  assert.equal(detectFramework('@SpringBootApplication public class DemoApp {}'), 'spring-boot');
  assert.equal(detectFramework('dependencies { implementation "io.quarkus:quarkus-arc" }'), 'quarkus');
  assert.equal(detectFramework('@QuarkusMain public class Main {}'), 'quarkus');
  assert.equal(detectFramework('public class PlainJavaApp {}'), 'general');
  assert.equal(detectFramework(''), 'general');
  assert.equal(detectFramework(null as unknown as string), 'general');
});

test('parseJavaBuildLog: Maven compiler errors on Unix and Windows', () => {
  const mavenUnixLog = `
[INFO] Scanning for projects...
[ERROR] /Users/demo/src/main/java/com/example/OrderService.java:[42,15] cannot find symbol
[ERROR]   symbol:   class IdempotencyKey
[ERROR]   location: class com.example.OrderService
[INFO] 1 error
`;
  const resUnix = parseJavaBuildLog(mavenUnixLog);
  assert.equal(resUnix.tool, 'maven');
  assert.equal(resUnix.totalErrors, 1);
  assert.equal(resUnix.errors[0].file, '/Users/demo/src/main/java/com/example/OrderService.java');
  assert.equal(resUnix.errors[0].line, 42);
  assert.equal(resUnix.errors[0].column, 15);
  assert.equal(resUnix.errors[0].symbol, 'IdempotencyKey');
  assert.equal(resUnix.errors[0].category, 'cannot_find_symbol');

  const mavenWindowsLog = `
[ERROR] C:\\workspace\\demo\\src\\main\\java\\com\\example\\App.java:[108,22] cannot find symbol
[ERROR]   symbol:   variable unknownVar
`;
  const resWin = parseJavaBuildLog(mavenWindowsLog);
  assert.equal(resWin.totalErrors, 1);
  assert.equal(resWin.errors[0].file, 'C:\\workspace\\demo\\src\\main\\java\\com\\example\\App.java');
  assert.equal(resWin.errors[0].line, 108);
  assert.equal(resWin.errors[0].column, 22);
  assert.equal(resWin.errors[0].symbol, 'unknownVar');
});

test('parseJavaBuildLog: Gradle compiler errors on Unix, Windows, and Kotlin', () => {
  const gradleLog = `
> Task :compileJava FAILED
/Users/demo/src/main/java/com/example/UserService.java:25: error: cannot find symbol
    symbol: method getUserId()
C:\\project\\src\\main\\java\\com\\example\\Payment.java:50:18: error: incompatible types: java.lang.String cannot be converted to int
e: /Users/demo/src/main/kotlin/com/example/Handler.kt:15:4: Unresolved reference: UserDTO
`;
  const res = parseJavaBuildLog(gradleLog);
  assert.equal(res.tool, 'gradle');
  assert.equal(res.totalErrors, 3);

  // Lombok method detection
  assert.equal(res.errors[0].file, '/Users/demo/src/main/java/com/example/UserService.java');
  assert.equal(res.errors[0].line, 25);
  assert.equal(res.errors[0].category, 'lombok_issue');
  assert.equal(res.errors[0].symbol, 'getUserId');

  // Incompatible types with column and Windows path
  assert.equal(res.errors[1].file, 'C:\\project\\src\\main\\java\\com\\example\\Payment.java');
  assert.equal(res.errors[1].line, 50);
  assert.equal(res.errors[1].column, 18);
  assert.equal(res.errors[1].category, 'incompatible_types');

  // Kotlin Unresolved reference
  assert.equal(res.errors[2].file, '/Users/demo/src/main/kotlin/com/example/Handler.kt');
  assert.equal(res.errors[2].line, 15);
  assert.equal(res.errors[2].column, 4);
  assert.equal(res.errors[2].category, 'cannot_find_symbol');
  assert.equal(res.errors[2].symbol, 'UserDTO');
});

test('parseJavaBuildLog: Jakarta EE 9+ / javax mismatch preserves file/line', () => {
  const javaxLog = `
[ERROR] /Users/demo/src/main/java/com/example/OrderService.java:[88,20] package javax.servlet does not exist
`;
  const res = parseJavaBuildLog(javaxLog);
  assert.equal(res.totalErrors, 1);
  assert.equal(res.errors[0].category, 'jakarta_javax_mismatch');
  assert.equal(res.errors[0].file, '/Users/demo/src/main/java/com/example/OrderService.java');
  assert.equal(res.errors[0].line, 88);
  assert.equal(res.errors[0].column, 20);
});

test('parseJavaBuildLog: MapStruct and annotation processor conflicts', () => {
  const mapstructLog = `
[ERROR] /Users/demo/src/main/java/com/example/UserMapper.java:[15,8] Can't generate mapping method from User to UserVO
[ERROR] No implementation was created for UserMapper
`;
  const res = parseJavaBuildLog(mapstructLog);
  assert.equal(res.totalErrors, 2);
  assert.equal(res.errors[0].category, 'mapstruct_issue');
  assert.equal(res.errors[0].file, '/Users/demo/src/main/java/com/example/UserMapper.java');
});

test('parseJavaBuildLog: Checkstyle and SpotBugs plugin failures', () => {
  const checkstyleLog = `
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-checkstyle-plugin:3.1.2:check (validate) on project demo: You have 3 Checkstyle violations.
`;
  const res = parseJavaBuildLog(checkstyleLog);
  assert.equal(res.totalErrors, 1);
  assert.equal(res.errors[0].category, 'checkstyle_spotbugs');
});

test('parseJavaBuildLog: Network and mirror download failures', () => {
  const netErrLog = `
[ERROR] Failed to execute goal on project demo: Could not resolve dependencies for project: Transfer failed for https://repo.maven.apache.org/... Connection refused
[ERROR] 502 Bad Gateway
`;
  const res = parseJavaBuildLog(netErrLog);
  assert.equal(res.isNetworkOrMirrorFailure, true);
  assert.equal(res.errors[0].category, 'dependency_network_failure');
});

test('parseJavaBuildLog: JDK version and bytecode version mismatch', () => {
  const jdkErrLog = `
[ERROR] Source option 8 is no longer supported. Use 17 or later.
[ERROR] demo/App has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version only recognizes up to 61.0
`;
  const res = parseJavaBuildLog(jdkErrLog);
  assert.equal(res.isJdkVersionIssue, true);
  assert.equal(res.errors[0].category, 'jdk_version_mismatch');
  assert.equal(res.errors[1].category, 'jdk_version_mismatch');
});

test('parseJavaBuildLog: Edge cases (empty, non-Java log, huge input limit)', () => {
  assert.deepEqual(parseJavaBuildLog(''), {
    tool: 'unknown',
    framework: 'general',
    totalErrors: 0,
    errors: [],
    isNetworkOrMirrorFailure: false,
    isJdkVersionIssue: false,
  });

  const nonJavaLog = 'TypeError: Cannot read properties of undefined (reading "map") at index.js:12:4';
  const resNonJava = parseJavaBuildLog(nonJavaLog);
  assert.equal(resNonJava.totalErrors, 0);

  // Huge log test (150 errors) - should cap at 100
  const hugeLines: string[] = [];
  for (let i = 0; i < 150; i++) {
    hugeLines.push(`[ERROR] /Users/demo/App${i}.java:[${i},1] cannot find symbol`);
  }
  const resHuge = parseJavaBuildLog(hugeLines.join('\n'));
  assert.equal(resHuge.totalErrors, 100);
});

test('DSH Plugin: tools definition, schema and execute functions', async () => {
  assert.equal(name, 'build-resolver-java');
  assert.deepEqual(inject, ['tools', 'systemPrompt']);
  assert.equal(tools.length, 2);

  const parseTool = tools.find((t) => t.name === 'java_parse_build_errors')!;
  assert.ok(parseTool);
  assert.equal(parseTool.output.schema.type, 'string');
  assert.equal(typeof parseTool.output.render, 'function');

  const parseOut = await parseTool.execute({
    buildLog: '[ERROR] /Users/demo/App.java:[10,2] cannot find symbol',
  });
  const parsedObj = JSON.parse(parseOut);
  assert.equal(parsedObj.totalErrors, 1);
  assert.equal(parsedObj.errors[0].file, '/Users/demo/App.java');

  const inspectTool = tools.find((t) => t.name === 'java_inspect_project')!;
  assert.ok(inspectTool);
  const inspectOut = await inspectTool.execute({
    buildFileContent: '<groupId>org.springframework.boot</groupId>',
  });
  const inspectedObj = JSON.parse(inspectOut);
  assert.equal(inspectedObj.framework, 'spring-boot');

  // Test apply(ctx) with Cordis context mock
  const registeredTools: unknown[] = [];
  const registeredSections: unknown[] = [];

  const mockCtx = {
    tools: {
      register(tool: unknown) {
        registeredTools.push(tool);
      },
    },
    systemPrompt: {
      section(sec: unknown) {
        registeredSections.push(sec);
      },
      getSectionOrder() {
        return 10200;
      },
    },
  };

  apply(mockCtx);
  assert.equal(registeredTools.length, 2);
  assert.equal(registeredSections.length, 1);
});

/* =========================================================================
 * Adversarial Red-Team Test Suite (Round 2)
 * ========================================================================= */

test('Red-Team 1: ANSI escape codes (CSI, OSC, 256-color, 24-bit RGB) must not break regex or corrupt parsed paths', () => {
  // Test direct stripAnsi utility
  const rawAnsi = '\u001b]0;Build Terminal\u0007\u001b[38;2;255;0;0m[ERROR]\u001b[0m \u001b[38;5;196m/Users/demo/App.java\u001b[0m:[\u001b[33m25\u001b[0m,\u001b[33m18\u001b[0m] \u001b[2K\u001b[1;31mcannot find symbol\u001b[m';
  assert.equal(stripAnsi(rawAnsi), '[ERROR] /Users/demo/App.java:[25,18] cannot find symbol');

  // Colored Maven log with ANSI codes
  const coloredMavenLog = `
\u001b[36m[INFO] Scanning for projects...\u001b[0m
\u001b[1;31m[ERROR]\u001b[0m \u001b[34m/Users/demo/src/main/java/com/example/OrderService.java\u001b[0m:[\u001b[33m42\u001b[0m,\u001b[33m15\u001b[0m] \u001b[1;31mcannot find symbol\u001b[0m
\u001b[1;31m[ERROR]\u001b[0m \u001b[32m  symbol:   class IdempotencyKey\u001b[0m
\u001b[1;31m[ERROR]\u001b[0m \u001b[32m  location: class com.example.OrderService\u001b[0m
\u001b[36m[INFO]\u001b[0m \u001b[1m1 error\u001b[0m
`;
  const resMaven = parseJavaBuildLog(coloredMavenLog);
  assert.equal(resMaven.tool, 'maven');
  assert.equal(resMaven.totalErrors, 1);
  assert.equal(resMaven.errors[0].file, '/Users/demo/src/main/java/com/example/OrderService.java');
  assert.equal(resMaven.errors[0].line, 42);
  assert.equal(resMaven.errors[0].column, 15);
  assert.equal(resMaven.errors[0].symbol, 'IdempotencyKey');
  assert.equal(resMaven.errors[0].category, 'cannot_find_symbol');

  // Colored Gradle log with ANSI codes
  const coloredGradleLog = `
\u001b[31m> Task :compileJava FAILED\u001b[0m
\u001b[33m/Users/demo/src/main/java/com/example/UserService.java:25: \u001b[31merror: cannot find symbol\u001b[0m
\u001b[36m    symbol: method getUserId()\u001b[0m
`;
  const resGradle = parseJavaBuildLog(coloredGradleLog);
  assert.equal(resGradle.tool, 'gradle');
  assert.equal(resGradle.totalErrors, 1);
  assert.equal(resGradle.errors[0].file, '/Users/demo/src/main/java/com/example/UserService.java');
  assert.equal(resGradle.errors[0].line, 25);
  assert.equal(resGradle.errors[0].symbol, 'getUserId');
  assert.equal(resGradle.errors[0].category, 'lombok_issue');

  // CI/CD timestamps preceding [ERROR]
  const ciLog = `
2026-10-27T12:00:00.123 [ERROR] /Users/demo/ci/Job.java:[10,20] cannot find symbol
[14:23:05] [ERROR] /Users/demo/ci/Worker.java:[30,5] package com.example.foo does not exist
`;
  const resCi = parseJavaBuildLog(ciLog);
  assert.equal(resCi.totalErrors, 2);
  assert.equal(resCi.errors[0].file, '/Users/demo/ci/Job.java');
  assert.equal(resCi.errors[0].line, 10);
  assert.equal(resCi.errors[1].file, '/Users/demo/ci/Worker.java');
  assert.equal(resCi.errors[1].line, 30);
  assert.equal(resCi.errors[1].category, 'package_not_exist');
});

test('Red-Team 2: Maven Reactor multi-module and POM failure parsing', () => {
  const mavenReactorPomLog = `
[INFO] Scanning for projects...
[ERROR] [ERROR] Some problems were encountered while processing the POMs:
[ERROR] Non-resolvable parent POM for com.example:submodule:1.0-SNAPSHOT: Could not find artifact com.example:parent:pom:1.0-SNAPSHOT in central and 'parent.relativePath' points at wrong local POM @ line 5, column 11
[ERROR] 'dependencies.dependency.version' for com.foo:bar:jar is missing. @ /workspace/modules/core/pom.xml, line 45, column 17
[ERROR] Child module /workspace/modules/missing-module/pom.xml of /workspace/pom.xml does not exist
[ERROR] Failed to execute goal on project service: Could not resolve dependencies for project com.example:service:jar:1.0.0: The following artifacts could not be resolved: com.example:core:jar:1.0.0: Could not find artifact com.example:core:jar:1.0.0 in central
`;
  const resReactor = parseJavaBuildLog(mavenReactorPomLog);
  assert.equal(resReactor.tool, 'maven');
  assert.equal(resReactor.isNetworkOrMirrorFailure, false); // Missing artifact is dependency_unresolved, NOT network error
  assert.ok(resReactor.totalErrors >= 4);

  // 1. Non-resolvable parent POM
  const parentPomErr = resReactor.errors.find((e) => e.line === 5 && e.column === 11);
  assert.ok(parentPomErr);
  assert.equal(parentPomErr.file, 'pom.xml');
  assert.equal(parentPomErr.category, 'dependency_unresolved');
  assert.ok(parentPomErr.suggestedAction?.includes('parent.relativePath'));

  // 2. Missing dependency version with explicit sub-pom path
  const verErr = resReactor.errors.find((e) => e.line === 45 && e.column === 17);
  assert.ok(verErr);
  assert.equal(verErr.file, '/workspace/modules/core/pom.xml');
  assert.equal(verErr.category, 'dependency_unresolved');
  assert.ok(verErr.suggestedAction?.includes('<version>'));

  // 3. Child module does not exist
  const childErr = resReactor.errors.find((e) => e.file === '/workspace/pom.xml');
  assert.ok(childErr);
  assert.equal(childErr.category, 'dependency_unresolved');
  assert.ok(childErr.suggestedAction?.includes('<modules>'));

  // 4. Missing subproject jar dependency
  const missingDepErr = resReactor.errors.find((e) => e.message.includes('Could not resolve dependencies for project'));
  assert.ok(missingDepErr);
  assert.equal(missingDepErr.category, 'dependency_unresolved');

  // Double [ERROR] with compiler error inside multi-module subproject
  const reactorCompileLog = `
[INFO] Reactor Summary for Parent 1.0.0:
[INFO] core ............................................... SUCCESS [ 1.2 s]
[INFO] service ............................................ FAILURE [ 0.5 s]
[ERROR] [ERROR] /workspace/service/src/main/java/com/demo/Service.java:[55,12] cannot find symbol
[ERROR]   symbol:   class OrderRepository
`;
  const resCompile = parseJavaBuildLog(reactorCompileLog);
  assert.equal(resCompile.tool, 'maven');
  assert.equal(resCompile.totalErrors, 1);
  assert.equal(resCompile.errors[0].file, '/workspace/service/src/main/java/com/demo/Service.java');
  assert.equal(resCompile.errors[0].line, 55);
  assert.equal(resCompile.errors[0].column, 12);
  assert.equal(resCompile.errors[0].symbol, 'OrderRepository');
});

test('Red-Team 3: Gradle parallel task execution and missing dependencies', () => {
  const gradleParallelLog = `
> Task :subprojects:order-service:compileJava FAILED
/workspace/subprojects/order-service/src/main/java/com/demo/OrderService.java:18: error: cannot find symbol
symbol: class PaymentGateway

> Task :subprojects:user-service:compileJava FAILED
  /workspace/subprojects/user-service/src/main/java/com/demo/UserService.java:33:14: error: cannot find symbol
symbol: method getEmail()

> Task :subprojects:gateway:compileJava FAILED
> Could not resolve all files for configuration ':gateway:compileClasspath'.
   > Could not find com.example:security-jwt:2.1.0.

FAILURE: Build completed with 3 failures.
1: Task failed with an exception.
-----------
* What went wrong:
Execution failed for task ':subprojects:order-service:compileJava'.
`;
  const res = parseJavaBuildLog(gradleParallelLog);
  assert.equal(res.tool, 'gradle');
  assert.equal(res.totalErrors, 3);

  // Error 1: order-service
  assert.equal(res.errors[0].file, '/workspace/subprojects/order-service/src/main/java/com/demo/OrderService.java');
  assert.equal(res.errors[0].line, 18);
  assert.equal(res.errors[0].category, 'cannot_find_symbol');
  assert.equal(res.errors[0].symbol, 'PaymentGateway');

  // Error 2: user-service with leading indentation and Lombok getter
  assert.equal(res.errors[1].file, '/workspace/subprojects/user-service/src/main/java/com/demo/UserService.java');
  assert.equal(res.errors[1].line, 33);
  assert.equal(res.errors[1].column, 14);
  assert.equal(res.errors[1].category, 'lombok_issue');
  assert.equal(res.errors[1].symbol, 'getEmail');

  // Error 3: gradle missing dependency
  assert.equal(res.errors[2].file, 'build.gradle');
  assert.equal(res.errors[2].category, 'dependency_unresolved');
  assert.equal(res.errors[2].symbol, 'com.example:security-jwt:2.1.0');
});

test('Red-Team 4: Complex nested generics, backticks, and bounds mismatch in type errors', () => {
  // 1. Complex nested generic type mismatch in Maven
  const genericLog = `
[ERROR] /workspace/src/main/java/com/foo/Service.java:[88,25] incompatible types: java.util.Map<java.lang.String,java.util.List<com.foo.Bar<java.lang.Integer>>> cannot be converted to java.util.Map<java.lang.String,com.foo.Bar<java.lang.Integer>>
[ERROR]   required: java.util.Map<java.lang.String,com.foo.Bar<java.lang.Integer>>
[ERROR]   found:    java.util.Map<java.lang.String,java.util.List<com.foo.Bar<java.lang.Integer>>>
`;
  const resGeneric = parseJavaBuildLog(genericLog);
  assert.equal(resGeneric.totalErrors, 1);
  assert.equal(resGeneric.errors[0].category, 'incompatible_types');
  assert.equal(
    resGeneric.errors[0].symbol,
    'java.util.Map<java.lang.String,java.util.List<com.foo.Bar<java.lang.Integer>>> -> java.util.Map<java.lang.String,com.foo.Bar<java.lang.Integer>>'
  );
  assert.ok(resGeneric.errors[0].suggestedAction?.includes('java.util.Map<java.lang.String,com.foo.Bar<java.lang.Integer>>'));

  // 2. Backtick-wrapped type mismatch in Kotlin
  const kotlinTypeLog = `
e: /workspace/src/main/kotlin/com/foo/Handler.kt:45:10: Type mismatch: inferred type is \`Map<String, List<Bar>>\` but \`Map<String, Bar>\` was expected
`;
  const resKotlin = parseJavaBuildLog(kotlinTypeLog);
  assert.equal(resKotlin.totalErrors, 1);
  assert.equal(resKotlin.errors[0].category, 'incompatible_types');
  assert.equal(resKotlin.errors[0].symbol, 'Map<String, List<Bar>> -> Map<String, Bar>');

  // 3. Generic bounds conflict
  const boundsLog = `
[ERROR] /workspace/src/main/java/com/foo/Factory.java:[30,15] incompatible types: inference variable T has incompatible bounds
[ERROR]     equality constraints: java.util.List<java.lang.String>
[ERROR]     lower bounds: java.util.Collection<java.lang.Integer>
`;
  const resBounds = parseJavaBuildLog(boundsLog);
  assert.equal(resBounds.totalErrors, 1);
  assert.equal(resBounds.errors[0].category, 'incompatible_types');
  assert.ok(resBounds.errors[0].suggestedAction?.includes('incompatible bounds'));
});

test('Red-Team 5: DSH plugin specifications (dsh-plugin.json, cordis.patch.yml, package.json)', () => {
  const rootDir = path.resolve(import.meta.dirname, '..');

  // Verify dsh-plugin.json exists and adheres to DSH manifest schema
  const manifestPath = path.join(rootDir, 'dsh-plugin.json');
  assert.ok(fs.existsSync(manifestPath), 'dsh-plugin.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.id, 'build-resolver-java');
  assert.equal(manifest.entry, 'dist/index.js');
  assert.equal(manifest.kind, 'plugin');
  assert.ok(manifest.compatibility && manifest.compatibility.dsh);
  assert.ok(Array.isArray(manifest.skills) && manifest.skills.includes('skills/java-build-resolver'));

  // Verify cordis.patch.yml exists and declares insert row
  const patchPath = path.join(rootDir, 'cordis.patch.yml');
  assert.ok(fs.existsSync(patchPath), 'cordis.patch.yml must exist');
  const patchContent = fs.readFileSync(patchPath, 'utf-8');
  assert.ok(patchContent.includes('build-resolver-java'));
  assert.ok(patchContent.includes('dsh-build-resolver-java'));

  // Verify package.json contains dsh.bundle.patch and files declarations
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  assert.ok(pkg.dsh, 'package.json must contain "dsh" config block');
  assert.equal(pkg.dsh.bundle.patch, 'cordis.patch.yml');
  assert.ok(pkg.files.includes('dsh-plugin.json'), 'files array must include dsh-plugin.json');
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files array must include cordis.patch.yml');
});

test('Red-Team 6: ReDoS stress test & latency verification (100k+ chars repeat backtrack triggers under 50ms)', () => {
  // 1. ANSI stripping 200k chars malformed/unclosed OSC & CSI
  const ansiStart = performance.now();
  stripAnsi('\u001b]' + 'a'.repeat(100000) + '\u001b[' + '1;'.repeat(50000) + 'm');
  assert.ok(performance.now() - ansiStart < 50, 'stripAnsi must finish within 50ms');

  // 2. 100k chars repeated [ERROR] tags without match
  const errStart = performance.now();
  parseJavaBuildLog('[ERROR] '.repeat(20000) + 'trailing garbage\n');
  assert.ok(performance.now() - errStart < 50, 'repeated [ERROR] must finish within 50ms');

  // 3. 100k chars POM line/column backtrack trigger
  const pomStart = performance.now();
  parseJavaBuildLog('[ERROR] ' + 'line 1, '.repeat(15000) + 'non-resolvable parent\n');
  assert.ok(performance.now() - pomStart < 50, 'POM backtrack trigger must finish within 50ms');

  // 4. 100k chars Child module ... of ... trigger
  const childStart = performance.now();
  parseJavaBuildLog('Child module ' + 'of '.repeat(20000) + '\n');
  assert.ok(performance.now() - childStart < 50, 'Child module trigger must finish within 50ms');

  // 5. 100k chars nested generic incompatible types
  const genStart = performance.now();
  parseJavaBuildLog('[ERROR] /path/Test.java:[10,5] incompatible types: ' + 'java.util.Map<java.lang.String, java.util.List<java.lang.Integer>> '.repeat(2000) + '\n');
  assert.ok(performance.now() - genStart < 50, 'Incompatible types trigger must finish within 50ms');

  // 6. 100k chars Gradle .java.java repeat trigger
  const gradStart = performance.now();
  parseJavaBuildLog('e: /path/Test' + '.java'.repeat(25000) + '\n');
  assert.ok(performance.now() - gradStart < 50, 'Gradle repeat trigger must finish within 50ms');

  // 7. detectBuildTool 200k chars > Task : repeat trigger
  const dtStart = performance.now();
  detectBuildTool('> Task :' + 'Task :Task :'.repeat(15000) + 'no-failed-here\n');
  assert.ok(performance.now() - dtStart < 50, 'detectBuildTool trigger must finish within 50ms');
});

/* =========================================================================
 * Golden Cases: Chinese Enterprise Java Classic Pitfalls (Round 4 Benchmark)
 * ========================================================================= */

test('Golden Case 1: Chinese Enterprise Pitfall - Windows GBK / unmappable character source encoding error', () => {
  // 1. Maven compiler error on Windows with GBK/windows-1252 unmappable character
  const mavenEncodingLog = `
[INFO] Scanning for projects...
[ERROR] C:\\workspace\\demo\\src\\main\\java\\com\\example\\UserService.java:[42,15] unmappable character (0xE4) for encoding windows-1252
[ERROR] C:\\workspace\\demo\\src\\main\\java\\com\\example\\CommonConstants.java:[15,8] unmappable character for encoding GBK
[ERROR] unmappable character for encoding UTF-8
`;
  const resMaven = parseJavaBuildLog(mavenEncodingLog);
  assert.equal(resMaven.totalErrors, 3);

  // Line 1: UserService.java windows-1252
  const err1 = resMaven.errors[0];
  assert.equal(err1.file, 'C:\\workspace\\demo\\src\\main\\java\\com\\example\\UserService.java');
  assert.equal(err1.line, 42);
  assert.equal(err1.column, 15);
  assert.equal(err1.category, 'encoding_error');
  assert.equal(err1.symbol, 'windows-1252');
  assert.ok(err1.suggestedAction?.includes('project.build.sourceEncoding'));
  assert.ok(err1.suggestedAction?.includes('UTF-8'));

  // Line 2: CommonConstants.java GBK
  const err2 = resMaven.errors[1];
  assert.equal(err2.file, 'C:\\workspace\\demo\\src\\main\\java\\com\\example\\CommonConstants.java');
  assert.equal(err2.line, 15);
  assert.equal(err2.column, 8);
  assert.equal(err2.category, 'encoding_error');
  assert.equal(err2.symbol, 'GBK');

  // Line 3: Standalone unmappable character line
  const err3 = resMaven.errors[2];
  assert.equal(err3.category, 'encoding_error');
  assert.equal(err3.symbol, 'UTF-8');

  // 2. Gradle compiler error with GBK encoding
  const gradleEncodingLog = `
> Task :compileJava FAILED
/workspace/demo/src/main/java/com/example/App.java:18: error: unmappable character for encoding GBK
`;
  const resGradle = parseJavaBuildLog(gradleEncodingLog);
  assert.equal(resGradle.totalErrors, 1);
  assert.equal(resGradle.errors[0].file, '/workspace/demo/src/main/java/com/example/App.java');
  assert.equal(resGradle.errors[0].line, 18);
  assert.equal(resGradle.errors[0].category, 'encoding_error');
  assert.equal(resGradle.errors[0].symbol, 'GBK');
  assert.ok(resGradle.errors[0].suggestedAction?.includes('options.encoding = "UTF-8"'));
});

test('Golden Case 2: Chinese Enterprise Pitfall - JDK 17/21 InaccessibleObjectException strong encapsulation reflection', () => {
  const surefireReflectionLog = `
-------------------------------------------------------
 T E S T S
-------------------------------------------------------
[ERROR] java.lang.reflect.InaccessibleObjectException: Unable to make protected final java.lang.Class java.lang.ClassLoader.defineClass(java.lang.String,byte[],int,int,java.security.ProtectionDomain) accessible: module java.base does not "opens java.lang" to unnamed module @6d311334
\tat java.base/java.lang.reflect.AccessibleObject.checkCanSetAccessible(AccessibleObject.java:354)
\tat net.bytebuddy.dynamic.loading.ByteArrayClassLoader.<clinit>(ByteArrayClassLoader.java:82)
Caused by: java.lang.reflect.InaccessibleObjectException: Unable to make field private final java.lang.reflect.Field java.lang.reflect.Field.modifiers accessible: module java.base does not "opens java.lang.reflect" to unnamed module @2752f6e2
`;
  const res = parseJavaBuildLog(surefireReflectionLog);
  assert.equal(res.isJdkVersionIssue, true);
  assert.equal(res.totalErrors, 2);

  // Error 1: java.base/java.lang
  assert.equal(res.errors[0].category, 'jdk_reflection_inaccessible');
  assert.equal(res.errors[0].symbol, 'java.base/java.lang');
  assert.ok(res.errors[0].suggestedAction?.includes('--add-opens java.base/java.lang=ALL-UNNAMED'));
  assert.ok(res.errors[0].suggestedAction?.includes('maven-surefire-plugin'));

  // Error 2: java.base/java.lang.reflect
  assert.equal(res.errors[1].category, 'jdk_reflection_inaccessible');
  assert.equal(res.errors[1].symbol, 'java.base/java.lang.reflect');
  assert.ok(res.errors[1].suggestedAction?.includes('--add-opens java.base/java.lang.reflect=ALL-UNNAMED'));
});

test('Golden Case 3: Chinese Enterprise Pitfall - Maven Enforcer plugin BannedDependencies and DependencyConvergence', () => {
  const enforcerLog = `
[INFO] --- maven-enforcer-plugin:3.0.0:enforce (enforce-rules) @ user-service ---
[ERROR] Rule 0: org.apache.maven.plugins.enforcer.BannedDependencies failed with message:
[ERROR] Found Banned Dependency: commons-logging:commons-logging:jar:1.2
[ERROR] Use 'mvn dependency:tree' to locate the source of the banned dependencies.
[ERROR] Rule 1: org.apache.maven.plugins.enforcer.DependencyConvergence failed with message:
[ERROR] Dependency convergence error for org.slf4j:slf4j-api:1.7.36 paths to dependency are:
[ERROR] +-com.example:user-service:1.0.0
[ERROR]   +-org.springframework.boot:spring-boot-starter-logging:2.7.0
[ERROR]     +-org.slf4j:slf4j-api:1.7.36
[ERROR] and
[ERROR] +-com.example:user-service:1.0.0
[ERROR]   +-com.alibaba:druid:1.2.8
[ERROR]     +-org.slf4j:slf4j-api:1.7.25
`;
  const res = parseJavaBuildLog(enforcerLog);
  assert.equal(res.tool, 'maven');
  assert.ok(res.totalErrors >= 2);

  // 1. BannedDependencies
  const bannedErr = res.errors.find((e) => e.message.includes('BannedDependencies') || e.message.includes('Found Banned Dependency'));
  assert.ok(bannedErr);
  assert.equal(bannedErr.file, 'pom.xml');
  assert.equal(bannedErr.category, 'enforcer_rule_failure');
  assert.equal(bannedErr.symbol, 'commons-logging:commons-logging:jar:1.2');
  assert.ok(bannedErr.suggestedAction?.includes('<exclusions>'));
  assert.ok(bannedErr.suggestedAction?.includes('commons-logging'));

  // 2. DependencyConvergence
  const convErr = res.errors.find((e) => e.message.includes('DependencyConvergence') || e.message.includes('Dependency convergence error'));
  assert.ok(convErr);
  assert.equal(convErr.file, 'pom.xml');
  assert.equal(convErr.category, 'enforcer_rule_failure');
  assert.equal(convErr.symbol, 'org.slf4j:slf4j-api:1.7.36');
  assert.ok(convErr.suggestedAction?.includes('<dependencyManagement>'));
});

test('Golden Case 4: Chinese Enterprise Pitfall - MyBatis / MyBatis-Plus Mapper XML resource missing & build-time check', async () => {
  // 1. Runtime / Test execution Invalid bound statement error
  const mybatisLog = `
[ERROR] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0
[ERROR] org.apache.ibatis.binding.BindingException: Invalid bound statement (not found): com.example.mapper.UserMapper.selectById
\tat org.apache.ibatis.binding.MapperMethod$SqlCommand.<init>(MapperMethod.java:235)
[ERROR] com.baomidou.mybatisplus.core.exceptions.MybatisPlusException: Invalid bound statement (not found): com.example.dao.OrderMapper.insert
`;
  const res = parseJavaBuildLog(mybatisLog);
  assert.equal(res.totalErrors, 2);

  // UserMapper.selectById
  assert.equal(res.errors[0].category, 'mybatis_mapper_missing');
  assert.equal(res.errors[0].file, 'UserMapper.xml');
  assert.equal(res.errors[0].symbol, 'com.example.mapper.UserMapper.selectById');
  assert.ok(res.errors[0].suggestedAction?.includes('<build><resources>'));
  assert.ok(res.errors[0].suggestedAction?.includes('src/main/java'));
  assert.ok(res.errors[0].suggestedAction?.includes('**/*.xml'));

  // OrderMapper.insert
  assert.equal(res.errors[1].category, 'mybatis_mapper_missing');
  assert.equal(res.errors[1].file, 'OrderMapper.xml');
  assert.equal(res.errors[1].symbol, 'com.example.dao.OrderMapper.insert');

  // 2. java_inspect_project build-time risk detection
  const inspectTool = tools.find((t) => t.name === 'java_inspect_project')!;
  const mybatisPomContent = `
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>demo-mybatis</artifactId>
    <version>1.0.0</version>
    <properties>
        <java.version>17</java.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter</artifactId>
        </dependency>
        <dependency>
            <groupId>com.baomidou</groupId>
            <artifactId>mybatis-plus-boot-starter</artifactId>
            <version>3.5.5</version>
        </dependency>
    </dependencies>
</project>
`;
  const inspectOut = await inspectTool.execute({ buildFileContent: mybatisPomContent });
  const inspectData = JSON.parse(inspectOut);
  assert.equal(inspectData.tool, 'maven');
  assert.equal(inspectData.framework, 'spring-boot');
  assert.ok(Array.isArray(inspectData.potentialRisks));
  // Should warn about sourceEncoding missing
  assert.ok(inspectData.potentialRisks.some((r: string) => r.includes('project.build.sourceEncoding')));
  // Should warn about mybatis XML resources
  assert.ok(inspectData.potentialRisks.some((r: string) => r.includes('MyBatis') && r.includes('**/*.xml')));
  // Should warn about JDK 17 reflection --add-opens
  assert.ok(inspectData.potentialRisks.some((r: string) => r.includes('--add-opens')));
});

test('Golden Case 5: ReDoS stress test & latency verification for 4 enterprise scenarios (under 50ms)', () => {
  // 1. 100k chars repeated unmappable character line
  const encStart = performance.now();
  parseJavaBuildLog('[ERROR] ' + 'unmappable character for encoding GBK '.repeat(3000) + '\n');
  assert.ok(performance.now() - encStart < 50, 'Encoding error trigger must finish within 50ms');

  // 2. 100k chars repeated InaccessibleObjectException line
  const refStart = performance.now();
  parseJavaBuildLog('java.lang.reflect.InaccessibleObjectException: module java.base does not opens java.lang to ' + 'unnamed module '.repeat(4000) + '\n');
  assert.ok(performance.now() - refStart < 50, 'InaccessibleObjectException trigger must finish within 50ms');

  // 3. 100k chars repeated Enforcer BannedDependency line
  const enfStart = performance.now();
  parseJavaBuildLog('[ERROR] Found Banned Dependency: ' + 'com.example:banned-lib:jar:1.0:compile '.repeat(3000) + '\n');
  assert.ok(performance.now() - enfStart < 50, 'Enforcer trigger must finish within 50ms');

  // 4. 100k chars repeated Invalid bound statement line
  const mybStart = performance.now();
  parseJavaBuildLog('[ERROR] Invalid bound statement (not found): ' + 'com.example.mapper.UserMapper.selectById '.repeat(3000) + '\n');
  assert.ok(performance.now() - mybStart < 50, 'MyBatis bound statement trigger must finish within 50ms');
});


