import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseJavaBuildLog, detectBuildTool, detectFramework, stripAnsi } from '../dist/parser.js';
import { tools, apply, name, inject } from '../dist/index.js';

test('detectBuildTool should recognize maven, gradle, and unknown variants', () => {
  assert.equal(detectBuildTool('pom.xml exists in directory'), 'maven');
  assert.equal(detectBuildTool('<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion></project>'), 'maven');
  assert.equal(detectBuildTool('Execution failed: > Task :compileJava FAILED'), 'gradle');
  assert.equal(detectBuildTool('plugins { id "java" } dependencies { testImplementation "junit" }'), 'gradle');
  assert.equal(detectBuildTool('random text without build files'), 'unknown');
  assert.equal(detectBuildTool(''), 'unknown');
});

test('detectFramework should recognize spring-boot, quarkus, and general', () => {
  assert.equal(detectFramework('<groupId>org.springframework.boot</groupId>'), 'spring-boot');
  assert.equal(detectFramework('@SpringBootApplication public class DemoApplication {}'), 'spring-boot');
  assert.equal(detectFramework('dependencies { implementation "io.quarkus:quarkus-arc" }'), 'quarkus');
  assert.equal(detectFramework('import javax.enterprise.context.ApplicationScoped;'), 'general');
});

test('parseJavaBuildLog: Maven compiler errors on Unix and Windows', () => {
  const mavenLog = `
[INFO] Scanning for projects...
[ERROR] /Users/demo/src/main/java/com/example/OrderService.java:[42,15] cannot find symbol
[ERROR]   symbol:   class IdempotencyKey
[ERROR]   location: class com.example.OrderService
[ERROR] C:\\workspace\\demo\\src\\main\\java\\com\\example\\UserService.java:[88,20] cannot find symbol
[ERROR]   symbol:   method getUserId()
[INFO] 2 errors
  `;

  const res = parseJavaBuildLog(mavenLog);
  assert.equal(res.tool, 'maven');
  assert.equal(res.totalErrors, 2);
  assert.equal(res.errors[0].file, '/Users/demo/src/main/java/com/example/OrderService.java');
  assert.equal(res.errors[0].line, 42);
  assert.equal(res.errors[0].symbol, 'IdempotencyKey');
  assert.equal(res.errors[0].category, 'cannot_find_symbol');

  assert.equal(res.errors[1].file, 'C:\\workspace\\demo\\src\\main\\java\\com\\example\\UserService.java');
  assert.equal(res.errors[1].category, 'lombok_issue');
  assert.equal(res.errors[1].symbol, 'getUserId');
});

test('parseJavaBuildLog: Context Bleed Prevention (B1 regression fix)', () => {
  // A subsequent jakarta line MUST NOT corrupt the previous cannot find symbol error!
  const mixedLog = `
[ERROR] /x/A.java:[10,5] cannot find symbol
[ERROR]   symbol:   class Foo
[ERROR] /x/B.java:[20,5] package javax.servlet does not exist
  `;

  const res = parseJavaBuildLog(mixedLog);
  assert.equal(res.totalErrors, 2);
  assert.equal(res.errors[0].category, 'cannot_find_symbol');
  assert.equal(res.errors[0].symbol, 'Foo');
  assert.equal(res.errors[1].category, 'jakarta_javax_mismatch');
});

test('parseJavaBuildLog: Catch-all on build failure (B2 regression fix)', () => {
  const failedLog = `
[INFO] Scanning for projects...
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:compile: Fatal error compiling
  `;

  const res = parseJavaBuildLog(failedLog);
  assert.equal(res.totalErrors, 1);
  assert.equal(res.errors[0].category, 'unknown');
  assert.ok(res.errors[0].message.includes('BUILD FAILURE'));
});

test('parseJavaBuildLog: Gradle compiler errors on Unix, Windows, and Kotlin', () => {
  const gradleLog = `
> Task :compileJava FAILED
/app/src/main/java/com/example/Bar.java:15: error: cannot find symbol
    symbol: class Baz
C:\\project\\src\\main\\java\\com\\example\\Win.java:30:12: error: cannot be applied to given types
e: /app/src/main/kotlin/com/example/KtService.kt:50:5: error: unresolved reference: unknownFun
  `;

  const res = parseJavaBuildLog(gradleLog);
  assert.equal(res.tool, 'gradle');
  assert.equal(res.totalErrors, 3);
  assert.equal(res.errors[0].file, '/app/src/main/java/com/example/Bar.java');
  assert.equal(res.errors[0].line, 15);
  assert.equal(res.errors[0].category, 'cannot_find_symbol');

  assert.equal(res.errors[1].file, 'C:\\project\\src\\main\\java\\com\\example\\Win.java');
  assert.equal(res.errors[1].line, 30);
  assert.equal(res.errors[1].column, 12);
  assert.equal(res.errors[1].category, 'method_not_applicable');

  assert.equal(res.errors[2].file, '/app/src/main/kotlin/com/example/KtService.kt');
  assert.equal(res.errors[2].line, 50);
});

test('parseJavaBuildLog: Network and mirror download failures', () => {
  const netErrLog = `
[ERROR] Failed to execute goal on project demo: Could not resolve dependencies: Transfer failed for https://repo.maven.apache.org/... Connection refused
[ERROR] java.net.UnknownHostException: repo.maven.apache.org
  `;
  const res = parseJavaBuildLog(netErrLog);
  assert.equal(res.isNetworkOrMirrorFailure, true);
  assert.ok(res.errors.length >= 1);
  assert.equal(res.errors[0].category, 'dependency_network_failure');
});

test('parseJavaBuildLog: Edge cases and truncation', () => {
  const emptyRes = parseJavaBuildLog('');
  assert.equal(emptyRes.totalErrors, 0);
  assert.equal(emptyRes.truncated, false);

  // 150 errors
  let hugeLog = '';
  for (let i = 0; i < 150; i++) {
    hugeLog += `[ERROR] /app/Foo.java:[${i},1] cannot find symbol\n`;
  }
  const hugeRes = parseJavaBuildLog(hugeLog);
  assert.equal(hugeRes.totalErrors, 100);
  assert.equal(hugeRes.truncated, true);
});

test('DSH Plugin: lifecycle, tools, and export forms', async () => {
  assert.equal(name, 'build-resolver-java');
  assert.deepEqual(inject, ['tools', 'systemPrompt']);

  // Validate tools schema & execution
  const parseTool = tools.find((t) => t.name === 'java_parse_build_errors')!;
  const inspectTool = tools.find((t) => t.name === 'java_inspect_project')!;

  assert.ok(parseTool);
  assert.ok(inspectTool);

  // Argument validation: missing or invalid args must throw
  await assert.rejects(async () => {
    await (parseTool.execute as any)({});
  }, /INVALID_ARGS/);

  await assert.rejects(async () => {
    await (inspectTool.execute as any)({ buildFileContent: 123 });
  }, /INVALID_ARGS/);

  // Test apply(ctx) with full mock context
  const registeredTools: any[] = [];
  let registeredSection: any = null;
  let registeredSkill: any = null;

  const mockCtx = {
    tools: {
      register: (t: any) => registeredTools.push(t),
    },
    systemPrompt: {
      section: (s: any) => {
        registeredSection = s;
      },
    },
    skills: {
      register: (sk: any) => {
        registeredSkill = sk;
      },
    },
    inject: (deps: string[], cb: Function) => cb(mockCtx),
    effect: (fn: Function) => fn(),
  };

  apply(mockCtx);

  assert.equal(registeredTools.length, 2);
  assert.ok(registeredSection);
  assert.equal(registeredSection.name, 'java-build-resolver');
  assert.equal(typeof registeredSection.text, 'string');
  assert.ok(registeredSkill);
  assert.equal(registeredSkill.name, 'java-build-resolver');
  assert.equal(typeof registeredSkill.source, 'string');
  assert.ok(registeredSkill.resourceBase);
});

test('DSH Plugin: cordis.patch.yml must be a top-level YAML array', () => {
  const patchPath = resolve(import.meta.dirname, '../cordis.patch.yml');
  assert.ok(existsSync(patchPath), 'cordis.patch.yml must exist');
  const patchContent = readFileSync(patchPath, 'utf8');
  // Strip comments and empty lines
  const nonCommentLines = patchContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.ok(
    nonCommentLines.length > 0 && nonCommentLines[0].startsWith('- insert:'),
    'cordis.patch.yml must start with a top-level YAML array "- insert:"'
  );
});

test('DSH Plugin: locale metadata files must exist and be valid JSON', () => {
  const enPath = resolve(import.meta.dirname, '../locale/en.json');
  const zhPath = resolve(import.meta.dirname, '../locale/zh.json');
  assert.ok(existsSync(enPath), 'locale/en.json must exist');
  assert.ok(existsSync(zhPath), 'locale/zh.json must exist');

  const en = JSON.parse(readFileSync(enPath, 'utf8'));
  const zh = JSON.parse(readFileSync(zhPath, 'utf8'));

  assert.ok(en.meta && en.meta.title && en.meta.description);
  assert.ok(zh.meta && zh.meta.title && zh.meta.description);
});

test('Golden Case 1: Encoding errors (Windows GBK / unmappable character)', () => {
  const encLog = `
[ERROR] C:\\workspace\\demo\\src\\main\\java\\com\\example\\UserService.java:[42,15] unmappable character (0xE4) for encoding windows-1252
  `;
  const res = parseJavaBuildLog(encLog);
  assert.equal(res.totalErrors, 1);
  assert.equal(res.errors[0].category, 'encoding_error');
  assert.equal(res.errors[0].symbol, 'windows-1252');
  assert.equal(res.errors[0].line, 42);
});

test('Golden Case 2: JDK 17/21 strong encapsulation (InaccessibleObjectException)', () => {
  const reflectLog = `
[ERROR] java.lang.reflect.InaccessibleObjectException: Unable to make field private final java.lang.String accessible: module java.base does not "opens java.lang" to unnamed module @6d311334
  `;
  const res = parseJavaBuildLog(reflectLog);
  assert.equal(res.isJdkVersionIssue, true);
  assert.equal(res.errors[0].category, 'jdk_reflection_inaccessible');
  assert.equal(res.errors[0].symbol, 'java.base/java.lang');
  assert.ok(res.errors[0].suggestedAction?.includes('--add-opens'));
});

test('Golden Case 3: Maven Enforcer rules (BannedDependencies & DependencyConvergence)', () => {
  const enforcerLog = `
[ERROR] Rule 0: org.apache.maven.enforcer.rules.dependency.BannedDependencies failed with message:
[ERROR] Found Banned Dependency: commons-logging:commons-logging:jar:1.2
  `;
  const res = parseJavaBuildLog(enforcerLog);
  assert.equal(res.totalErrors, 1);
  assert.equal(res.errors[0].category, 'enforcer_rule_failure');
  assert.equal(res.errors[0].symbol, 'BannedDependencies');
});

test('Golden Case 4: MyBatis/MyBatis-Plus missing XML', () => {
  const mybatisLog = `
org.apache.ibatis.binding.BindingException: Invalid bound statement (not found): com.example.mapper.UserMapper.selectById
  `;
  const res = parseJavaBuildLog(mybatisLog);
  assert.equal(res.totalErrors, 1);
  assert.equal(res.errors[0].category, 'mybatis_mapper_missing');
  assert.equal(res.errors[0].symbol, 'com.example.mapper.UserMapper.selectById');
});

test('Red-Team ReDoS: linear execution under 50ms', () => {
  const start = performance.now();
  let evilLog = '';
  for (let i = 0; i < 5000; i++) {
    evilLog += `[ERROR] [ERROR] [ERROR] some unclosed line without pattern\n`;
  }
  parseJavaBuildLog(evilLog);
  const duration = performance.now() - start;
  assert.ok(duration < 50, `ReDoS check failed, duration was ${duration}ms`);
});
