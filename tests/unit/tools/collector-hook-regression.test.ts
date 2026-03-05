/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {collectCode} from '../../../src/tools/collector.js';
import {getHookData} from '../../../src/tools/hook.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';

type RuntimeMethod = (...args: unknown[]) => unknown;

interface ToolResponseHarness {
  lines: string[];
  appendResponseLine(value: string): void;
  setIncludePages(): void;
  setIncludeNetworkRequests(): void;
  setIncludeConsoleData(): void;
  attachImage(): void;
  attachNetworkRequest(): void;
  attachConsoleMessage(): void;
  setIncludeWebSocketConnections(): void;
  attachWebSocket(): void;
}

interface ToolDefinitionHarness {
  handler(request: {params: Record<string, unknown>}, response: ToolResponseHarness, context: object): Promise<void>;
}

function makeResponse(): ToolResponseHarness {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
  };
}

describe('collector/hook regressions', () => {
  it('collect_code should collect before top-priority view', async () => {
    const runtime = getJSHookRuntime() as unknown as {
      collector: {
        collect: RuntimeMethod;
        getTopPriorityFiles: RuntimeMethod;
      };
    };

    const originalCollect = runtime.collector.collect;
    const originalTop = runtime.collector.getTopPriorityFiles;

    let collectCalls = 0;
    runtime.collector.collect = (async () => {
      collectCalls += 1;
      return {
        files: [
          {url: 'https://example.com/a.js', content: 'const a=1;', size: 10, type: 'external'},
        ],
        dependencies: {nodes: [], edges: []},
        totalSize: 10,
        collectTime: 1,
      };
    }) as RuntimeMethod;
    runtime.collector.getTopPriorityFiles = (() => ({
      files: [
        {url: 'https://example.com/a.js', content: 'const a=1;', size: 10, type: 'external'},
      ],
      totalSize: 10,
      totalFiles: 1,
    })) as RuntimeMethod;

    try {
      const response = makeResponse();
      await (collectCode as unknown as ToolDefinitionHarness).handler(
        {params: {url: 'https://example.com', returnMode: 'top-priority'}},
        response,
        {},
      );

      assert.strictEqual(collectCalls, 1, 'collect_code should trigger collector.collect first');
      assert.ok(response.lines.join('\n').includes('"totalFiles": 1'));
    } finally {
      runtime.collector.collect = originalCollect;
      runtime.collector.getTopPriorityFiles = originalTop;
    }
  });

  it('get_hook_data should sync data from window.__hookStore', async () => {
    const runtime = getJSHookRuntime() as unknown as {
      collector: {
        getActivePage: RuntimeMethod;
      };
      hookManager: {
        clearAll: RuntimeMethod;
        create: RuntimeMethod;
      };
    };

    const originalGetActivePage = runtime.collector.getActivePage;
    runtime.hookManager.clearAll();

    const created = runtime.hookManager.create({type: 'fetch'}) as {hookId: string};

    runtime.collector.getActivePage = (async () => ({
      evaluate: async (fn: (hookId?: string) => unknown, hookId?: string) => {
        return {
          [hookId || created.hookId]: [
            {
              hookId: hookId || created.hookId,
              target: 'fetch',
              event: 'request',
              method: 'GET',
              url: 'https://example.com/api',
              status: 200,
              body: '{"ok":true}',
              timestamp: Date.now(),
            },
          ],
        };
      },
    })) as RuntimeMethod;

    try {
      const response = makeResponse();
      await (getHookData as unknown as ToolDefinitionHarness).handler(
        {params: {hookId: created.hookId, view: 'summary'}},
        response,
        {},
      );

      const output = response.lines.join('\n');
      assert.ok(output.includes('"total": 1'), 'summary should include synced records');
      assert.ok(output.includes('https://example.com/api'));
    } finally {
      runtime.collector.getActivePage = originalGetActivePage;
      runtime.hookManager.clearAll();
    }
  });
});
