import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {zod} from '../third_party/index.js';
import {defineTool} from './ToolDefinition.js';
import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';

async function writeArtifactFile(taskDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(taskDir, relativePath);
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
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
    entryCode: zod.string(),
    envCode: zod.string(),
    polyfillsCode: zod.string().optional(),
    capture: zod.record(zod.string(), zod.unknown()),
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

    await writeArtifactFile(task.taskDir, 'env/entry.js', `${request.params.entryCode}\n`);
    await writeArtifactFile(task.taskDir, 'env/env.js', `${request.params.envCode}\n`);
    await writeArtifactFile(task.taskDir, 'env/polyfills.js', `${request.params.polyfillsCode ?? ''}\n`);
    await writeArtifactFile(task.taskDir, 'env/capture.json', `${JSON.stringify(request.params.capture, null, 2)}\n`);

    const report = [
      '# Rebuild Bundle',
      '',
      `- Task: ${request.params.taskId}`,
      `- Target URL: ${request.params.targetUrl}`,
      `- Goal: ${request.params.goal}`,
      '',
      '## Notes',
      ...request.params.notes.map((note) => `- ${note}`),
    ].join('\n');
    await writeArtifactFile(task.taskDir, 'report.md', `${report}\n`);

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      ok: true,
      taskId: task.taskId,
      taskDir: task.taskDir,
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
