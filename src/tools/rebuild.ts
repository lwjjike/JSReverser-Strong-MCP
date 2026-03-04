
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {zod} from '../third_party/index.js';
import type {CodeFile} from '../types/index.js';

import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {defineTool} from './ToolDefinition.js';

async function writeArtifactFile(taskDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(taskDir, relativePath);
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
}

function buildDefaultEnvCode(): string {
  return [
    'globalThis.window = globalThis;',
    'globalThis.self = globalThis;',
    'globalThis.global = globalThis;',
    'globalThis.document ??= {cookie: "", location: {href: ""}};',
    'globalThis.navigator ??= {userAgent: "js-reverse-mcp"};',
    'globalThis.location ??= {href: ""};',
    'globalThis.atob ??= (value) => Buffer.from(value, "base64").toString("utf8");',
    'globalThis.btoa ??= (value) => Buffer.from(value, "utf8").toString("base64");',
    'globalThis.crypto ??= {subtle: {}};',
  ].join('\n');
}

function toStorageShimCode(name: 'localStorage' | 'sessionStorage', values: Record<string, unknown>): string {
  const entries = Object.entries(values);
  return [
    `const ${name}Seed = new Map(${JSON.stringify(entries)});`,
    `globalThis.${name} = {`,
    '  getItem(key) { return this._store.has(key) ? this._store.get(key) : null; },',
    '  setItem(key, value) { this._store.set(String(key), String(value)); },',
    '  removeItem(key) { this._store.delete(String(key)); },',
    '  clear() { this._store.clear(); },',
    '  key(index) { return Array.from(this._store.keys())[index] ?? null; },',
    '  get length() { return this._store.size; },',
    `  _store: ${name}Seed,`,
    '};',
  ].join('\n');
}

function buildAutoEnvCode(capture: Record<string, unknown>): string {
  const cookies = Array.isArray(capture.cookies) ? capture.cookies : [];
  const localStorageValues = capture.localStorage && typeof capture.localStorage === 'object'
    ? capture.localStorage as Record<string, unknown>
    : {};
  const sessionStorageValues = capture.sessionStorage && typeof capture.sessionStorage === 'object'
    ? capture.sessionStorage as Record<string, unknown>
    : {};
  const page = capture.page && typeof capture.page === 'object'
    ? capture.page as Record<string, unknown>
    : {};

  return [
    buildDefaultEnvCode(),
    `globalThis.location = {href: ${JSON.stringify(page.url ?? '')}};`,
    `globalThis.document = {cookie: ${JSON.stringify(cookies.map((cookie) => `${String((cookie as Record<string, unknown>).name ?? '')}=${String((cookie as Record<string, unknown>).value ?? '')}`).join('; '))}, location: globalThis.location};`,
    toStorageShimCode('localStorage', localStorageValues),
    toStorageShimCode('sessionStorage', sessionStorageValues),
  ].join('\n\n');
}

function buildAutoEntryCode(targetScript: CodeFile | undefined, capture: Record<string, unknown>): string {
  return [
    'import "./env.js";',
    'import "./polyfills.js";',
    '',
    `const capture = ${JSON.stringify(capture, null, 2)};`,
    `capture.targetScript = ${JSON.stringify(targetScript ?? null, null, 2)};`,
    '',
    'if (capture.targetScript?.content) {',
    '  eval(capture.targetScript.content);',
    '}',
    '',
    'const targetFunction = capture.runtimeEvidence?.find((item) => typeof item.functionName === "string")?.functionName;',
    'if (targetFunction && typeof globalThis[targetFunction] === "function") {',
    '  console.log({targetFunction, result: globalThis[targetFunction]("token", "nonce")});',
    '} else {',
    '  console.log({message: "target function not callable yet", targetFunction});',
    '}',
  ].join('\n');
}

function matchesTargetText(
  value: unknown,
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
): boolean {
  const text = typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value ?? '').toLowerCase();
  return targetKeywords.some((keyword) => text.includes(keyword.toLowerCase())) ||
    targetUrlPatterns.some((pattern) => text.includes(pattern.toLowerCase())) ||
    targetFunctionNames.some((functionName) => text.includes(functionName.toLowerCase())) ||
    (targetActionDescription.length > 0 && text.includes(targetActionDescription.toLowerCase()));
}

function filterRuntimeEvidence(
  records: Record<string, unknown>[],
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
  maxEvidenceItems: number,
): Record<string, unknown>[] {
  const filtered = (
    targetKeywords.length === 0 &&
    targetUrlPatterns.length === 0 &&
    targetFunctionNames.length === 0 &&
    targetActionDescription.length === 0
  )
    ? records
    : records.filter((record) => matchesTargetText(
      record,
      targetKeywords,
      targetUrlPatterns,
      targetFunctionNames,
      targetActionDescription,
    ));
  return filtered.slice(0, maxEvidenceItems);
}

function pickTargetScript(
  files: CodeFile[],
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
): CodeFile | undefined {
  if (
    targetKeywords.length === 0 &&
    targetUrlPatterns.length === 0 &&
    targetFunctionNames.length === 0 &&
    targetActionDescription.length === 0
  ) {
    return files[0];
  }
  return files.find((file) => matchesTargetText(
    file,
    targetKeywords,
    targetUrlPatterns,
    targetFunctionNames,
    targetActionDescription,
  )) ?? files[0];
}

async function buildAutoBundle(
  taskId: string,
  runtime: ReturnType<typeof getJSHookRuntime>,
  options: {
    targetKeywords: string[];
    targetUrlPatterns: string[];
    targetFunctionNames: string[];
    targetActionDescription: string;
    maxEvidenceItems: number;
  },
): Promise<{
  entryCode: string;
  envCode: string;
  polyfillsCode: string;
  capture: Record<string, unknown>;
  notes: string[];
}> {
  const topPriority = runtime.collector.getTopPriorityFiles(1);
  const targetScript = pickTargetScript(
    topPriority.files,
    options.targetKeywords,
    options.targetUrlPatterns,
    options.targetFunctionNames,
    options.targetActionDescription,
  );
  const page = await runtime.pageController.getPage();
  const [cookies, localStorage, sessionStorage, runtimeEvidence] = await Promise.all([
    runtime.pageController.getCookies(),
    runtime.pageController.getLocalStorage(),
    runtime.pageController.getSessionStorage(),
    runtime.reverseTaskStore.readLog('runtime-evidence', taskId),
  ]);
  const filteredRuntimeEvidence = filterRuntimeEvidence(
    runtimeEvidence,
    options.targetKeywords,
    options.targetUrlPatterns,
    options.targetFunctionNames,
    options.targetActionDescription,
    options.maxEvidenceItems,
  );

  const capture = {
    page: {
      url: page.url(),
      title: await page.title(),
    },
    cookies,
    localStorage,
    sessionStorage,
    runtimeEvidence: filteredRuntimeEvidence,
    targetScript: targetScript ?? null,
  };

  return {
    entryCode: buildAutoEntryCode(targetScript, capture),
    envCode: buildAutoEnvCode(capture),
    polyfillsCode: '',
    capture,
    notes: [
      targetScript ? `auto-selected target script: ${targetScript.url}` : 'no target script selected from collector',
      filteredRuntimeEvidence.length > 0 ? `filtered runtime evidence records: ${filteredRuntimeEvidence.length}` : 'no runtime evidence records found after target filtering',
    ],
  };
}

function inferMissingCapabilities(runtimeError: string, observedCapabilities: string[]): Array<{
  capability: string;
  reason: string;
  priority: number;
}> {
  const available = new Set(observedCapabilities.map((item) => item.toLowerCase()));
  const normalizedError = runtimeError.toLowerCase();
  const candidates = [
    {
      capability: 'window',
      patterns: ['window is not defined'],
      reason: 'Browser global root is missing in local execution.',
      priority: 100,
    },
    {
      capability: 'document',
      patterns: ['document is not defined'],
      reason: 'DOM access is required by the captured browser path.',
      priority: 90,
    },
    {
      capability: 'localStorage',
      patterns: ['localstorage is not defined'],
      reason: 'Captured path reads browser storage values.',
      priority: 80,
    },
    {
      capability: 'sessionStorage',
      patterns: ['sessionstorage is not defined'],
      reason: 'Captured path reads session-scoped browser storage.',
      priority: 75,
    },
    {
      capability: 'crypto',
      patterns: ["reading 'subtle'", 'crypto is not defined'],
      reason: 'Captured path depends on browser crypto primitives.',
      priority: 85,
    },
  ];

  return candidates
    .filter((candidate) =>
      available.has(candidate.capability.toLowerCase()) &&
      candidate.patterns.some((pattern) => normalizedError.includes(pattern)),
    )
    .sort((a, b) => b.priority - a.priority);
}

export const exportRebuildBundle = defineTool({
  name: 'export_rebuild_bundle',
  description: 'Export a local Node rebuild bundle from observed reverse-engineering evidence.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    taskId: zod.string(),
    taskSlug: zod.string(),
    targetUrl: zod.string(),
    goal: zod.string(),
    autoGenerate: zod.boolean().optional(),
    targetKeywords: zod.array(zod.string()).optional(),
    targetUrlPatterns: zod.array(zod.string()).optional(),
    targetFunctionNames: zod.array(zod.string()).optional(),
    targetActionDescription: zod.string().optional(),
    maxEvidenceItems: zod.number().int().positive().optional(),
    entryCode: zod.string().optional(),
    envCode: zod.string().optional(),
    polyfillsCode: zod.string().optional(),
    capture: zod.record(zod.string(), zod.unknown()).optional(),
    notes: zod.array(zod.string()).default([]),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const task = await runtime.reverseTaskStore.openTask({
      taskId: request.params.taskId,
      slug: request.params.taskSlug,
      targetUrl: request.params.targetUrl,
      goal: request.params.goal,
    });

    const bundle = request.params.autoGenerate
      ? await buildAutoBundle(request.params.taskId, runtime, {
          targetKeywords: request.params.targetKeywords ?? [],
          targetUrlPatterns: request.params.targetUrlPatterns ?? [],
          targetFunctionNames: request.params.targetFunctionNames ?? [],
          targetActionDescription: request.params.targetActionDescription ?? '',
          maxEvidenceItems: request.params.maxEvidenceItems ?? 20,
        })
      : {
          entryCode: request.params.entryCode ?? '',
          envCode: request.params.envCode ?? '',
          polyfillsCode: request.params.polyfillsCode ?? '',
          capture: request.params.capture ?? {},
          notes: request.params.notes,
        };

    if (!request.params.autoGenerate && (!request.params.entryCode || !request.params.envCode || !request.params.capture)) {
      throw new Error('entryCode, envCode, and capture are required unless autoGenerate=true.');
    }

    await writeArtifactFile(task.taskDir, 'env/entry.js', `${bundle.entryCode}\n`);
    await writeArtifactFile(task.taskDir, 'env/env.js', `${bundle.envCode}\n`);
    await writeArtifactFile(task.taskDir, 'env/polyfills.js', `${bundle.polyfillsCode}\n`);
    await writeArtifactFile(task.taskDir, 'env/capture.json', `${JSON.stringify(bundle.capture, null, 2)}\n`);

    const report = [
      '# Rebuild Bundle',
      '',
      `- Task: ${request.params.taskId}`,
      `- Target URL: ${request.params.targetUrl}`,
      `- Goal: ${request.params.goal}`,
      '',
      '## Notes',
      ...bundle.notes.map((note) => `- ${note}`),
    ].join('\n');
    await writeArtifactFile(task.taskDir, 'report.md', `${report}\n`);

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      ok: true,
      taskId: task.taskId,
      taskDir: task.taskDir,
      autoGenerated: Boolean(request.params.autoGenerate),
      files: [
        'env/entry.js',
        'env/env.js',
        'env/polyfills.js',
        'env/capture.json',
        'report.md',
      ],
    }, null, 2));
    response.appendResponseLine('```');
  },
});

export const diffEnvRequirements = defineTool({
  name: 'diff_env_requirements',
  description: 'Compare local runtime failures with observed browser capabilities and suggest the next environment patches.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    runtimeError: zod.string(),
    observedCapabilities: zod.array(zod.string()).default([]),
  },
  handler: async (request, response) => {
    const missingCapabilities = inferMissingCapabilities(
      request.params.runtimeError,
      request.params.observedCapabilities,
    );
    const nextPatches = missingCapabilities.map((item) => ({
      capability: item.capability,
      reason: item.reason,
      suggestedPatch: `Add a minimal ${item.capability} shim based on browser evidence before retrying the entry script.`,
    }));

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      missingCapabilities: missingCapabilities.map((item) => item.capability),
      nextPatches,
    }, null, 2));
    response.appendResponseLine('```');
  },
});
