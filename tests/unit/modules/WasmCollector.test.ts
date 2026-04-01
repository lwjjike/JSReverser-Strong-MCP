/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {WasmAnalyzer} from '../../../src/modules/wasm/WasmAnalyzer.js';
import {WasmCollector} from '../../../src/modules/wasm/WasmCollector.js';
import {WasmRuntimeInspector} from '../../../src/modules/wasm/WasmRuntimeInspector.js';

const SIMPLE_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x73, 0x69, 0x67, 0x6e, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

function makePage(runtimeState: unknown) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      listeners.set(event, listeners.get(event) ?? new Set());
      listeners.get(event)?.add(handler);
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(handler);
    },
    async goto() {
      return undefined;
    },
    async evaluate() {
      return runtimeState;
    },
  };
}

describe('WasmCollector', () => {
  it('deduplicates runtime-captured modules and maps export calls back to a module', async () => {
    const page = makePage({
      modules: [
        {
          runtimeModuleId: 'rtm_1',
          timestamp: 1,
          loadMethod: 'compile',
          sourceType: 'array-buffer',
          byteLength: SIMPLE_WASM.byteLength,
          base64: Buffer.from(SIMPLE_WASM).toString('base64'),
          exportKeys: ['sign'],
        },
        {
          runtimeModuleId: 'rtm_2',
          timestamp: 2,
          loadMethod: 'instantiate',
          sourceType: 'array-buffer',
          byteLength: SIMPLE_WASM.byteLength,
          base64: Buffer.from(SIMPLE_WASM).toString('base64'),
          exportKeys: ['sign'],
        },
      ],
      events: [
        {
          id: 'evt_compile',
          type: 'compile',
          timestamp: 1,
          runtimeModuleId: 'rtm_1',
          loadMethod: 'compile',
          exportKeys: ['sign'],
        },
        {
          id: 'evt_call',
          type: 'export_call',
          timestamp: 3,
          runtimeModuleId: 'rtm_2',
          exportName: 'sign',
          resultEntries: [
            {
              key: 'x-itouchtv-ca-signature',
              value: 'abcd***wxyz',
              masked: true,
            },
          ],
          sideEffectHints: ['memory-bridge'],
        },
        {
          id: 'evt_sink',
          type: 'network_request',
          timestamp: 4,
          runtimeModuleId: 'rtm_2',
          method: 'POST',
          url: 'https://example.com/api/sign?ts=1',
          bodySnippet: 'payload=abcd1234',
          bodyKind: 'urlencoded',
          bodySegments: [
            {
              index: 0,
              raw: 'payload=abcd1234',
              displayValue: 'payload=abcd1234',
              classification: 'urlencoded',
              likelySignatureMaterial: false,
            },
          ],
          requestHeaders: [
            {
              name: 'x-itouchtv-ca-signature',
              value: 'abcd***wxyz',
              masked: true,
            },
          ],
        },
      ],
    });

    const collector = new WasmCollector(
      {
        getPage: async () => page,
        injectScriptOnNewDocument: async () => undefined,
      } as unknown as ConstructorParameters<typeof WasmCollector>[0],
      new WasmAnalyzer(),
      new WasmRuntimeInspector(),
    );

    const result = await collector.collect({
      url: 'https://example.com',
      waitAfterLoadMs: 0,
      maxModules: 10,
    });

    assert.strictEqual(result.totalModules, 1);
    assert.strictEqual(result.modules[0]?.exports[0]?.callCount, 1);
    assert.deepStrictEqual(result.modules[0]?.loadMethods.sort(), ['compile', 'instantiate']);
    assert.strictEqual(result.runtimeEvents[1]?.moduleId, result.modules[0]?.id);
    assert.deepStrictEqual(result.runtimeEvents[1]?.sideEffectHints, ['memory-bridge']);
    assert.strictEqual(result.runtimeEvents[2]?.bodyKind, 'urlencoded');
    assert.strictEqual(result.runtimeEvents[2]?.requestHeaders?.[0]?.name, 'x-itouchtv-ca-signature');
    assert.strictEqual(result.runtimeEvents[1]?.resultEntries?.[0]?.key, 'x-itouchtv-ca-signature');
  });
});
