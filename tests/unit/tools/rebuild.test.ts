import assert from 'node:assert';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {ReverseTaskStore} from '../../../src/reverse/ReverseTaskStore.js';
import {diffEnvRequirements, exportRebuildBundle} from '../../../src/tools/rebuild.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';

function makeResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (value: string) => {
      lines.push(value);
    },
  };
}

function extractFirstJsonBlock(lines: string[]): Record<string, unknown> {
  const start = lines.indexOf('```json');
  const end = lines.indexOf('```', start + 1);
  return JSON.parse(lines.slice(start + 1, end).join('\n')) as Record<string, unknown>;
}

describe('rebuild bridge tools', () => {
  it('exports a local rebuild bundle and prioritizes env patches from runtime errors', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'js-reverse-rebuild-'));
    const runtime = getJSHookRuntime() as any;
    const originalStore = runtime.reverseTaskStore;
    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const exportResponse = makeResponse();
      await exportRebuildBundle.handler({
        params: {
          taskId: 'task-001',
          taskSlug: 'demo',
          targetUrl: 'https://example.com',
          goal: 'rebuild signature',
          entryCode: 'import "./env.js";\nconsole.log(signToken("a", "b"));',
          envCode: 'globalThis.window = globalThis;',
          polyfillsCode: 'globalThis.atob = (v) => v;',
          capture: {
            cookies: [{name: 'sid', value: '1'}],
            requests: [{url: 'https://example.com/api/sign', method: 'POST'}],
          },
          notes: [
            'target request is /api/sign',
            'cookie sid participates in request chain',
          ],
        },
      } as any, exportResponse as any, {} as any);

      await stat(path.join(rootDir, 'task-001', 'env', 'entry.js'));
      await stat(path.join(rootDir, 'task-001', 'env', 'env.js'));
      await stat(path.join(rootDir, 'task-001', 'env', 'polyfills.js'));
      await stat(path.join(rootDir, 'task-001', 'env', 'capture.json'));
      await stat(path.join(rootDir, 'task-001', 'report.md'));

      const report = await readFile(path.join(rootDir, 'task-001', 'report.md'), 'utf8');
      assert.ok(report.includes('/api/sign'));
      assert.ok(report.includes('cookie sid'));

      const diffResponse = makeResponse();
      await diffEnvRequirements.handler({
        params: {
          runtimeError: 'ReferenceError: window is not defined\nReferenceError: localStorage is not defined\nTypeError: Cannot read properties of undefined (reading \'subtle\')',
          observedCapabilities: ['window', 'document', 'navigator', 'localStorage', 'crypto'],
        },
      } as any, diffResponse as any, {} as any);

      const diffJson = extractFirstJsonBlock(diffResponse.lines);
      assert.ok(Array.isArray(diffJson.missingCapabilities));
      assert.ok(Array.isArray(diffJson.nextPatches));
      assert.strictEqual((diffJson.nextPatches as Array<Record<string, unknown>>)[0].capability, 'window');
    } finally {
      runtime.reverseTaskStore = originalStore;
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
