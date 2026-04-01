/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {WasmAnalysisResult, WasmModuleRecord, WasmRuntimeEvent} from '../../../src/modules/wasm/WasmTypes.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';
import {
  analyzeWasmModule,
  analyzeWasmSignatureDiff,
  collectWasm,
  decompileWasmModule,
  inspectWasmExports,
  listWasmModules,
  summarizeWasmBoundary,
} from '../../../src/tools/wasm.js';

type RuntimeMethod = (...args: unknown[]) => unknown;

interface ToolResponseHarness {
  lines: string[];
  appendResponseLine(value: string): void;
}

interface ToolDefinitionHarness {
  handler(request: {params: unknown}, response: ToolResponseHarness, context: object): Promise<void>;
}

function makeResponse(): ToolResponseHarness {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (value) => lines.push(value),
  };
}

async function invokeTool(
  tool: ToolDefinitionHarness,
  params: Record<string, unknown>,
  response: ToolResponseHarness,
): Promise<void> {
  await tool.handler({params}, response, {});
}

describe('wasm tools', () => {
  it('covers collect/list/analyze/inspect handlers', async () => {
    const runtime = getJSHookRuntime() as unknown as {
      wasmCollector: {
        collect: RuntimeMethod;
        getModules: RuntimeMethod;
        getModuleById: RuntimeMethod;
        getModuleBytes: RuntimeMethod;
        getRuntimeEvents: RuntimeMethod;
      };
      wasmAnalyzer: {
        analyzeRecord: RuntimeMethod;
        analyzeBinary: RuntimeMethod;
      };
      wasmRuntimeInspector: {
        summarizeExports: RuntimeMethod;
        summarizeBoundary: RuntimeMethod;
        buildBoundaryChains: RuntimeMethod;
        analyzeSignatureDiff: RuntimeMethod;
      };
      wasmDecompiler: {
        decompile: RuntimeMethod;
      };
    };

    const moduleRecord: WasmModuleRecord = {
      id: 'wasm_test',
      hash: 'hash',
      size: 36,
      sourceUrl: 'https://example.com/app.wasm',
      contentType: 'application/wasm',
      loadMethods: ['network', 'instantiate'],
      firstSeenAt: 1,
      lastSeenAt: 2,
      imports: [],
      exports: [
        {
          name: 'sign',
          kind: 'function',
          index: 0,
          callCount: 2,
        },
      ],
      memories: [],
      sections: [],
      runtimeModuleIds: ['rtm_1'],
      origin: 'hybrid',
      fingerprints: [
        {
          family: 'crypto-likely',
          confidence: 0.75,
          reason: 'name matches signing keywords',
        },
      ],
      styleHints: ['Rust + wasm-bindgen glue'],
      riskTags: ['memory-bridge'],
      purposeHints: ['Looks crypto/signature related'],
      artifactPath: 'H:\\CodeSpace\\AiReverse\\MCP\\JSReverser-MCP\\artifacts\\tasks\\demo\\wasm\\bins\\hash.wasm',
    };
    const runtimeEvents: WasmRuntimeEvent[] = [
      {
        id: 'evt_1',
        type: 'instantiate',
        timestamp: 1,
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        exportKeys: ['sign'],
        requestHeaders: [
          {
            name: 'x-itouchtv-ca-signature',
            value: 'abcd***wxyz',
            masked: true,
          },
        ],
      },
    ];
    const analysis: WasmAnalysisResult = {
      moduleId: 'wasm_test',
      hash: 'hash',
      size: 36,
      sections: [],
      imports: [],
      exports: moduleRecord.exports,
      memories: [],
      functionCount: 1,
      importFunctionCount: 0,
      exportFunctionCount: 1,
      tableCount: 0,
      globalCount: 0,
      dataSegmentCount: 0,
      typeCount: 1,
      codeBodyCount: 1,
      dataSegments: [],
      stringSlots: [],
      headerCandidates: [],
      keyMaterialCandidates: [],
      styleHints: moduleRecord.styleHints,
      purposeHints: moduleRecord.purposeHints,
      riskTags: moduleRecord.riskTags,
      fingerprints: moduleRecord.fingerprints,
      summaryLines: ['Functions: 1 total'],
    };

    const originals = {
      collect: runtime.wasmCollector.collect,
      getModules: runtime.wasmCollector.getModules,
      getModuleById: runtime.wasmCollector.getModuleById,
      getModuleBytes: runtime.wasmCollector.getModuleBytes,
      getRuntimeEvents: runtime.wasmCollector.getRuntimeEvents,
      analyzeRecord: runtime.wasmAnalyzer.analyzeRecord,
      analyzeBinary: runtime.wasmAnalyzer.analyzeBinary,
      summarizeExports: runtime.wasmRuntimeInspector.summarizeExports,
      summarizeBoundary: runtime.wasmRuntimeInspector.summarizeBoundary,
      buildBoundaryChains: runtime.wasmRuntimeInspector.buildBoundaryChains,
      analyzeSignatureDiff: runtime.wasmRuntimeInspector.analyzeSignatureDiff,
      decompile: runtime.wasmDecompiler.decompile,
    };

    runtime.wasmCollector.collect = (async () => ({
      modules: [moduleRecord],
      runtimeEvents,
      totalModules: 1,
      totalRuntimeEvents: 1,
      collectedAt: '2026-03-26T00:00:00.000Z',
      artifacts: {
        rootDir: 'H:\\CodeSpace\\AiReverse\\MCP\\JSReverser-MCP\\artifacts\\tasks\\demo\\wasm',
      },
    })) as RuntimeMethod;
    runtime.wasmCollector.getModules = (() => [moduleRecord]) as RuntimeMethod;
    runtime.wasmCollector.getModuleById = ((moduleId: string) => (moduleId === 'wasm_test' ? moduleRecord : undefined)) as RuntimeMethod;
    runtime.wasmCollector.getModuleBytes = (() => Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])) as RuntimeMethod;
    runtime.wasmCollector.getRuntimeEvents = (() => runtimeEvents) as RuntimeMethod;
    runtime.wasmAnalyzer.analyzeRecord = (() => analysis) as RuntimeMethod;
    runtime.wasmAnalyzer.analyzeBinary = (() => ({
      ...analysis,
      moduleId: undefined,
      hash: undefined,
      size: undefined,
    })) as RuntimeMethod;
    runtime.wasmRuntimeInspector.summarizeExports = (() => [
      {
        name: 'sign',
        kind: 'function',
        callCount: 2,
        suspicion: 'high',
        reasons: ['name matches signature/crypto keywords'],
      },
    ]) as RuntimeMethod;
    runtime.wasmRuntimeInspector.summarizeBoundary = (() => ({
      importNamespaces: ['env'],
      topExports: ['sign'],
      stackSamples: [['glue.js:10:1']],
      sideEffectHints: ['memory-bridge'],
      candidateChains: [
        {
          moduleId: 'wasm_test',
          runtimeModuleId: 'rtm_1',
          exportName: 'sign',
          score: 9,
          startedAt: 1,
          endedAt: 3,
          writerHints: ['buffer access on memory'],
          readerHints: ['TextDecoder <- Uint8Array'],
          sinkHints: ['POST https://example.com/api/sign'],
          candidateJsCallers: ['glue.js:10:1'],
          headerCandidates: [
            {
              name: 'x-itouchtv-ca-signature',
              value: 'abcd***wxyz',
              masked: true,
            },
          ],
          returnValueHints: [],
          bodyAnalysis: {
            bodyKind: 'json',
            segments: [
              {
                index: 0,
                raw: '{"sign":"abc"}',
                displayValue: '{"sign":"abc"}',
                classification: 'json',
                likelySignatureMaterial: false,
              },
            ],
            hints: ['body-kind:json'],
            candidateWriters: ['{"sign":"abc"}'],
            candidateReaders: [],
          },
          networkTargets: [{
            method: 'POST',
            url: 'https://example.com/api/sign',
            bodySnippet: '{"sign":"abc"}',
            bodyKind: 'json',
            requestHeaders: [
              {
                name: 'x-itouchtv-ca-signature',
                value: 'abcd***wxyz',
                masked: true,
              },
            ],
          }],
          steps: [],
        },
      ],
    })) as RuntimeMethod;
    runtime.wasmRuntimeInspector.buildBoundaryChains = (() => [
      {
        moduleId: 'wasm_test',
        runtimeModuleId: 'rtm_1',
        exportName: 'sign',
        score: 9,
        startedAt: 1,
        endedAt: 3,
        writerHints: ['buffer access on memory'],
        readerHints: ['TextDecoder <- Uint8Array'],
        sinkHints: ['POST https://example.com/api/sign'],
        candidateJsCallers: ['glue.js:10:1'],
        headerCandidates: [
          {
            name: 'x-itouchtv-ca-signature',
            value: 'abcd***wxyz',
            masked: true,
          },
        ],
        returnValueHints: [],
        bodyAnalysis: {
          bodyKind: 'json',
          segments: [
            {
              index: 0,
              raw: '{"sign":"abc"}',
              displayValue: '{"sign":"abc"}',
              classification: 'json',
              likelySignatureMaterial: false,
            },
          ],
          hints: ['body-kind:json'],
          candidateWriters: ['{"sign":"abc"}'],
          candidateReaders: [],
        },
        networkTargets: [{
          method: 'POST',
          url: 'https://example.com/api/sign',
          bodySnippet: '{"sign":"abc"}',
          bodyKind: 'json',
          requestHeaders: [
            {
              name: 'x-itouchtv-ca-signature',
              value: 'abcd***wxyz',
              masked: true,
            },
          ],
        }],
        steps: [
          {
            type: 'export_call',
            timestamp: 2,
            description: 'call export sign',
            exportName: 'sign',
          },
        ],
      },
    ]) as RuntimeMethod;
    runtime.wasmRuntimeInspector.analyzeSignatureDiff = (() => ({
      moduleId: 'wasm_test',
      exportName: 'sign',
      sampleCount: 2,
      comparedChains: 2,
      observations: ['signature header changes with runtime input'],
      changedFields: [
        {
          field: 'x-itouchtv-ca-signature',
          location: 'request-header',
          variationCount: 2,
          examples: ['abcd***wxyz', 'wxyz***abcd'],
          impact: 'signature-candidate',
          notes: 'Header value shifts look consistent with runtime signature generation.',
        },
      ],
    })) as RuntimeMethod;
    runtime.wasmDecompiler.decompile = (async () => ({
      moduleId: 'wasm_test',
      hash: 'hash',
      size: 36,
      wat: '(module\n  (func $sign)\n)',
      lineCount: 3,
      functionCount: 1,
      importCount: 0,
      exportCount: 1,
      functionSummaries: [
        {
          name: '$sign',
          index: 0,
          paramCount: 0,
          resultCount: 0,
          instructionCount: 1,
          callCount: 0,
          indirectCallCount: 0,
          memoryLoadCount: 0,
          memoryStoreCount: 0,
          localAccessCount: 0,
          suspiciousTags: [],
          preview: ['(func $sign)'],
        },
      ],
    })) as RuntimeMethod;

    try {
      const response = makeResponse();

      await invokeTool(collectWasm as unknown as ToolDefinitionHarness, {
        url: 'https://example.com',
        includeRuntimeEvents: true,
      }, response);
      await invokeTool(listWasmModules as unknown as ToolDefinitionHarness, {}, response);
      await invokeTool(analyzeWasmModule as unknown as ToolDefinitionHarness, {
        moduleId: 'wasm_test',
      }, response);
      await invokeTool(inspectWasmExports as unknown as ToolDefinitionHarness, {
        moduleId: 'wasm_test',
      }, response);
      await invokeTool(summarizeWasmBoundary as unknown as ToolDefinitionHarness, {
        moduleId: 'wasm_test',
      }, response);
      await invokeTool(analyzeWasmSignatureDiff as unknown as ToolDefinitionHarness, {
        moduleId: 'wasm_test',
        exportName: 'sign',
      }, response);
      await invokeTool(decompileWasmModule as unknown as ToolDefinitionHarness, {
        moduleId: 'wasm_test',
        maxWatChars: 100,
      }, response);
      await assert.rejects(async () => {
        await invokeTool(analyzeWasmModule as unknown as ToolDefinitionHarness, {}, response);
      });

      const output = response.lines.join('\n');
      assert.ok(output.includes('"totalModules": 1'));
      assert.ok(output.includes('"moduleId": "wasm_test"'));
      assert.ok(output.includes('"exportSummary"'));
      assert.ok(output.includes('"topExports"'));
      assert.ok(output.includes('"chainCount": 1'));
      assert.ok(output.includes('"changedFields"'));
      assert.ok(output.includes('"wat": "(module'));
    } finally {
      runtime.wasmCollector.collect = originals.collect;
      runtime.wasmCollector.getModules = originals.getModules;
      runtime.wasmCollector.getModuleById = originals.getModuleById;
      runtime.wasmCollector.getModuleBytes = originals.getModuleBytes;
      runtime.wasmCollector.getRuntimeEvents = originals.getRuntimeEvents;
      runtime.wasmAnalyzer.analyzeRecord = originals.analyzeRecord;
      runtime.wasmAnalyzer.analyzeBinary = originals.analyzeBinary;
      runtime.wasmRuntimeInspector.summarizeExports = originals.summarizeExports;
      runtime.wasmRuntimeInspector.summarizeBoundary = originals.summarizeBoundary;
      runtime.wasmRuntimeInspector.buildBoundaryChains = originals.buildBoundaryChains;
      runtime.wasmRuntimeInspector.analyzeSignatureDiff = originals.analyzeSignatureDiff;
      runtime.wasmDecompiler.decompile = originals.decompile;
    }
  });
});
