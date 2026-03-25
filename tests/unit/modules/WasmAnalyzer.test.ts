/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {WasmAnalyzer} from '../../../src/modules/wasm/WasmAnalyzer.js';
import {WasmRuntimeInspector} from '../../../src/modules/wasm/WasmRuntimeInspector.js';
import type {WasmModuleRecord, WasmRuntimeEvent} from '../../../src/modules/wasm/WasmTypes.js';

const SIMPLE_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x73, 0x69, 0x67, 0x6e, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

describe('WasmAnalyzer', () => {
  it('parses core sections and exported functions', () => {
    const analyzer = new WasmAnalyzer();
    const analysis = analyzer.analyzeRecord(
      {
        id: 'wasm_test',
        hash: 'hash',
        size: SIMPLE_WASM.byteLength,
      },
      SIMPLE_WASM,
      {
        includeFunctionSignatures: true,
      },
    );

    assert.strictEqual(analysis.functionCount, 1);
    assert.strictEqual(analysis.exportFunctionCount, 1);
    assert.deepStrictEqual(
      analysis.sections.map((section) => section.name),
      ['type', 'function', 'export', 'code'],
    );
    assert.strictEqual(analysis.exports[0]?.name, 'sign');
    assert.ok(analysis.summaryLines.some((line) => line.includes('Functions: 1 total')));
  });

  it('summarizes export usage and boundary hints', () => {
    const inspector = new WasmRuntimeInspector();
    const moduleRecord: WasmModuleRecord = {
      id: 'wasm_test',
      hash: 'hash',
      size: SIMPLE_WASM.byteLength,
      sourceUrl: 'https://example.com/app.wasm',
      contentType: 'application/wasm',
      loadMethods: ['instantiate'],
      firstSeenAt: 1,
      lastSeenAt: 2,
      imports: [],
      exports: [
        {
          name: 'sign',
          kind: 'function',
          index: 0,
          params: [],
          results: [],
        },
      ],
      memories: [],
      sections: [],
      runtimeModuleIds: ['rtm_1'],
      origin: 'runtime',
      fingerprints: [],
      styleHints: [],
      riskTags: [],
      purposeHints: ['Looks crypto/signature related'],
    };
    const events: WasmRuntimeEvent[] = [
      {
        id: 'evt_compile',
        type: 'instantiate',
        timestamp: 10,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        exportKeys: ['sign'],
        stackSummary: ['glue.js:10:1'],
      },
      {
        id: 'evt_view',
        type: 'memory_view_create',
        timestamp: 10,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        viewType: 'Uint8Array',
        memoryExportName: 'memory',
        byteOffset: 0,
        byteLength: 32,
        sideEffectHints: ['memory-bridge'],
      },
      {
        id: 'evt_write',
        type: 'memory_write',
        timestamp: 10,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        viewType: 'Uint8Array',
        memoryExportName: 'memory',
        byteOffset: 0,
        byteLength: 32,
        sideEffectHints: ['typed-array-set'],
      },
      {
        id: 'evt_call',
        type: 'export_call',
        timestamp: 11,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        exportName: 'sign',
        sideEffectHints: ['memory-bridge'],
      },
      {
        id: 'evt_read',
        type: 'text_decode',
        timestamp: 12,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        viewType: 'Uint8Array',
        sideEffectHints: ['text-decode-from-memory'],
      },
      {
        id: 'evt_sink',
        type: 'network_request',
        timestamp: 13,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        method: 'POST',
        url: 'https://example.com/api/sign',
        bodySnippet: '{"sign":"abc"}',
      },
    ];

    const exportSummary = inspector.summarizeExports(moduleRecord, events);
    const boundary = inspector.summarizeBoundary(moduleRecord, events);

    assert.strictEqual(exportSummary[0]?.name, 'sign');
    assert.strictEqual(exportSummary[0]?.suspicion, 'medium');
    assert.deepStrictEqual(boundary.topExports, ['sign']);
    assert.ok(boundary.sideEffectHints.includes('memory-bridge'));
    assert.ok(boundary.sideEffectHints.includes('typed-array-set'));
    assert.strictEqual(boundary.candidateChains[0]?.exportName, 'sign');
    assert.ok((boundary.candidateChains[0]?.score ?? 0) >= 7);
    assert.ok(boundary.candidateChains[0]?.sinkHints.some((entry) => entry.includes('/api/sign')));
  });
});
