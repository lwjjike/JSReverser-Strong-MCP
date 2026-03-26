import {readFile} from 'node:fs/promises';

import type {
  DetectWasmResult,
  WasmBoundaryChainResult,
  WasmDecompileResultSummary,
  WasmModuleSummary,
  WasmRuntimeCaptureResult,
  WasmSignatureDiffResultSummary,
} from '../types/index.js';
import {zod} from '../third_party/index.js';
import type {
  WasmBoundaryChain,
  WasmDecompileResult,
  WasmDetectionResult,
  WasmModuleRecord,
  WasmRuntimeEvent,
  WasmSignatureDiffResult,
} from '../modules/wasm/WasmTypes.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';
import {getJSHookRuntime} from './runtime.js';

function appendJson(response: {appendResponseLine(value: string): void}, value: unknown): void {
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(value, null, 2));
  response.appendResponseLine('```');
}

function toModuleSummary(
  module: WasmModuleRecord,
  options: {
    includeImports?: boolean;
    includeExports?: boolean;
  } = {},
): WasmModuleSummary {
  return {
    id: module.id,
    hash: module.hash,
    size: module.size,
    sourceUrl: module.sourceUrl,
    contentType: module.contentType,
    loadMethods: [...module.loadMethods],
    origin: module.origin,
    imports: options.includeImports === false ? undefined : module.imports.map((entry) => ({...entry})),
    exports: options.includeExports === false ? undefined : module.exports.map((entry) => ({...entry})),
    memoryCount: module.memories.length,
    importCount: module.imports.length,
    exportCount: module.exports.length,
    styleHints: [...module.styleHints],
    purposeHints: [...module.purposeHints],
    riskTags: [...module.riskTags],
    fingerprints: module.fingerprints.map((entry) => ({...entry})),
    artifactPath: module.artifactPath,
  };
}

function toRuntimeCaptureResult(
  event: WasmRuntimeEvent,
): WasmRuntimeCaptureResult {
  return {
    ...event,
    importKeys: event.importKeys ? [...event.importKeys] : undefined,
    exportKeys: event.exportKeys ? [...event.exportKeys] : undefined,
    requestHeaders: event.requestHeaders ? event.requestHeaders.map((entry) => ({...entry})) : undefined,
    bodySegments: event.bodySegments ? event.bodySegments.map((entry) => ({...entry})) : undefined,
    argsPreview: event.argsPreview ? [...event.argsPreview] : undefined,
    resultEntries: event.resultEntries ? event.resultEntries.map((entry) => ({...entry})) : undefined,
    stackSummary: event.stackSummary ? [...event.stackSummary] : undefined,
    sideEffectHints: event.sideEffectHints ? [...event.sideEffectHints] : undefined,
    memory: event.memory ? event.memory.map((entry) => ({...entry})) : undefined,
  };
}

function toBoundaryChainResult(chain: WasmBoundaryChain): WasmBoundaryChainResult {
  return {
    ...chain,
    writerHints: [...chain.writerHints],
    readerHints: [...chain.readerHints],
    sinkHints: [...chain.sinkHints],
    candidateJsCallers: [...chain.candidateJsCallers],
    headerCandidates: chain.headerCandidates.map((entry) => ({...entry})),
    returnValueHints: chain.returnValueHints.map((entry) => ({...entry})),
    bodyAnalysis: chain.bodyAnalysis
      ? {
          ...chain.bodyAnalysis,
          hints: [...chain.bodyAnalysis.hints],
          candidateWriters: [...chain.bodyAnalysis.candidateWriters],
          candidateReaders: [...chain.bodyAnalysis.candidateReaders],
          segments: chain.bodyAnalysis.segments.map((entry) => ({...entry})),
        }
      : undefined,
    networkTargets: chain.networkTargets.map((entry) => ({
      ...entry,
      requestHeaders: entry.requestHeaders ? entry.requestHeaders.map((header) => ({...header})) : undefined,
    })),
    steps: chain.steps.map((step) => ({
      ...step,
      requestHeaders: step.requestHeaders ? step.requestHeaders.map((entry) => ({...entry})) : undefined,
      resultEntries: step.resultEntries ? step.resultEntries.map((entry) => ({...entry})) : undefined,
      stackSummary: step.stackSummary ? [...step.stackSummary] : undefined,
    })),
  };
}

function toSignatureDiffResult(result: WasmSignatureDiffResult): WasmSignatureDiffResultSummary {
  return {
    ...result,
    observations: [...result.observations],
    changedFields: result.changedFields.map((entry) => ({
      ...entry,
      examples: [...entry.examples],
    })),
  };
}

function toDecompileSummary(
  result: WasmDecompileResult,
  watLimit?: number,
): WasmDecompileResultSummary {
  const wat = typeof watLimit === 'number' && watLimit > 0 && result.wat.length > watLimit
    ? `${result.wat.slice(0, watLimit)}\n;; ... truncated ...`
    : result.wat;
  return {
    ...result,
    wat,
    functionSummaries: result.functionSummaries.map((entry) => ({
      ...entry,
      suspiciousTags: [...entry.suspiciousTags],
      preview: [...entry.preview],
    })),
  };
}

function toDetectWasmResult(
  detection: WasmDetectionResult,
  options: {
    includeImports?: boolean;
    includeExports?: boolean;
    includeRuntimeEvents?: boolean;
  } = {},
): DetectWasmResult {
  return {
    modules: detection.modules.map((module) => toModuleSummary(module, options)),
    runtimeEvents:
      options.includeRuntimeEvents === false
        ? []
        : detection.runtimeEvents.map((event) => toRuntimeCaptureResult(event)),
    totalModules: detection.totalModules,
    totalRuntimeEvents:
      options.includeRuntimeEvents === false ? 0 : detection.totalRuntimeEvents,
    collectedAt: detection.collectedAt,
    artifacts: detection.artifacts,
  };
}

async function openReverseTaskIfReady(params: {
  taskId?: string;
  taskSlug?: string;
  targetUrl?: string;
  goal?: string;
}) {
  const values = [params.taskId, params.taskSlug, params.targetUrl, params.goal];
  const providedCount = values.filter((value) => typeof value === 'string' && value.length > 0).length;
  if (providedCount === 0) {
    return undefined;
  }
  if (providedCount !== values.length) {
    throw new Error('taskId, taskSlug, targetUrl, and goal must all be provided together for Wasm artifacts.');
  }
  const runtime = getJSHookRuntime();
  return runtime.reverseTaskStore.openTask({
    taskId: params.taskId!,
    slug: params.taskSlug!,
    targetUrl: params.targetUrl!,
    goal: params.goal!,
  });
}

export const collectWasm = defineTool({
  name: 'collect_wasm',
  description: 'Collect Wasm modules from network responses and runtime instantiation hooks.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().url(),
    timeout: zod.number().int().positive().optional(),
    waitAfterLoadMs: zod.number().int().nonnegative().optional(),
    includeRuntimeEvents: zod.boolean().optional(),
    includeImports: zod.boolean().optional(),
    includeExports: zod.boolean().optional(),
    maxModules: zod.number().int().positive().optional(),
    captureBase64: zod.boolean().optional(),
    taskId: zod.string().optional(),
    taskSlug: zod.string().optional(),
    targetUrl: zod.string().url().optional(),
    goal: zod.string().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const task = await openReverseTaskIfReady(request.params);
    const detection = await runtime.wasmCollector.collect(request.params, task);
    const result = toDetectWasmResult(detection, request.params);
    appendJson(response, result);
  },
});

export const listWasmModules = defineTool({
  name: 'list_wasm_modules',
  description: 'List Wasm modules captured in the current session.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    includeImports: zod.boolean().optional(),
    includeExports: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const modules = runtime.wasmCollector
      .getModules()
      .map((module) => toModuleSummary(module, request.params));
    appendJson(response, {
      totalModules: modules.length,
      modules,
    });
  },
});

export const analyzeWasmModule = defineTool({
  name: 'analyze_wasm_module',
  description: 'Analyze one Wasm module by session module ID, base64 payload, or artifact path.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    moduleId: zod.string().optional(),
    base64: zod.string().optional(),
    artifactPath: zod.string().optional(),
    includeFunctionSignatures: zod.boolean().optional(),
    includeRawSectionMap: zod.boolean().optional(),
    includeStringScan: zod.boolean().optional(),
    maskSensitiveStrings: zod.boolean().optional(),
    maxStringSlots: zod.number().int().positive().optional(),
    maxSummaryLines: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const providedSources = [request.params.moduleId, request.params.base64, request.params.artifactPath]
      .filter((value) => typeof value === 'string' && value.length > 0);
    if (providedSources.length === 0) {
      throw new Error('Provide moduleId, base64, or artifactPath.');
    }
    if (providedSources.length > 1) {
      throw new Error('Provide only one of moduleId, base64, or artifactPath.');
    }

    const analysisOptions = {
      includeFunctionSignatures: request.params.includeFunctionSignatures,
      includeRawSectionMap: request.params.includeRawSectionMap,
      includeStringScan: request.params.includeStringScan,
      maskSensitiveStrings: request.params.maskSensitiveStrings,
      maxStringSlots: request.params.maxStringSlots,
      maxSummaryLines: request.params.maxSummaryLines,
    };

    if (request.params.moduleId) {
      const module = runtime.wasmCollector.getModuleById(request.params.moduleId);
      const bytes = runtime.wasmCollector.getModuleBytes(request.params.moduleId);
      if (!module || !bytes) {
        throw new Error(`Unknown Wasm module ID: ${request.params.moduleId}`);
      }
      const analysis = runtime.wasmAnalyzer.analyzeRecord(
        {
          id: module.id,
          hash: module.hash,
          size: module.size,
        },
        bytes,
        analysisOptions,
      );
      appendJson(response, {
        module: toModuleSummary(module, {
          includeImports: true,
          includeExports: true,
        }),
        analysis,
      });
      return;
    }

    const bytes = request.params.base64
      ? Uint8Array.from(Buffer.from(request.params.base64, 'base64'))
      : Uint8Array.from(await readFile(request.params.artifactPath!));

    const analysis = runtime.wasmAnalyzer.analyzeBinary(bytes, analysisOptions);
    appendJson(response, {
      inline: {
        size: bytes.byteLength,
        source: request.params.base64 ? 'base64' : 'artifactPath',
      },
      analysis,
    });
  },
});

export const inspectWasmExports = defineTool({
  name: 'inspect_wasm_exports',
  description: 'Summarize Wasm export usage and likely high-value entry points.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    moduleId: zod.string(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const module = runtime.wasmCollector.getModuleById(request.params.moduleId);
    if (!module) {
      throw new Error(`Unknown Wasm module ID: ${request.params.moduleId}`);
    }
    const events = runtime.wasmCollector.getRuntimeEvents(request.params.moduleId);
    const exportSummary = runtime.wasmRuntimeInspector.summarizeExports(module, events);
    const boundary = runtime.wasmRuntimeInspector.summarizeBoundary(module, events);
    appendJson(response, {
      module: toModuleSummary(module, {
        includeImports: false,
        includeExports: true,
      }),
      exportSummary,
      boundary: {
        ...boundary,
        candidateChains: boundary.candidateChains.map((chain) => toBoundaryChainResult(chain)),
      },
    });
  },
});

export const summarizeWasmBoundary = defineTool({
  name: 'summarize_wasm_boundary',
  description: 'Build candidate JS -> memory bridge -> Wasm export -> sink chains for a captured Wasm module.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    moduleId: zod.string(),
    maxChains: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const module = runtime.wasmCollector.getModuleById(request.params.moduleId);
    if (!module) {
      throw new Error(`Unknown Wasm module ID: ${request.params.moduleId}`);
    }
    const chains = runtime.wasmRuntimeInspector
      .buildBoundaryChains(module, runtime.wasmCollector.getRuntimeEvents(request.params.moduleId))
      .slice(0, request.params.maxChains ?? 10)
      .map((chain) => toBoundaryChainResult(chain));
    appendJson(response, {
      module: toModuleSummary(module, {
        includeImports: false,
        includeExports: true,
      }),
      chainCount: chains.length,
      chains,
    });
  },
});

export const analyzeWasmSignatureDiff = defineTool({
  name: 'analyze_wasm_signature_diff',
  description: 'Compare captured JS-Wasm boundary chains to highlight which query/body/header inputs vary like signature material.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    moduleId: zod.string(),
    exportName: zod.string().optional(),
    maxChains: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const module = runtime.wasmCollector.getModuleById(request.params.moduleId);
    if (!module) {
      throw new Error(`Unknown Wasm module ID: ${request.params.moduleId}`);
    }
    const diff = runtime.wasmRuntimeInspector.analyzeSignatureDiff(
      module,
      runtime.wasmCollector.getRuntimeEvents(request.params.moduleId),
      {
        exportName: request.params.exportName,
        maxChains: request.params.maxChains,
      },
    );
    appendJson(response, {
      module: toModuleSummary(module, {
        includeImports: false,
        includeExports: true,
      }),
      diff: toSignatureDiffResult(diff),
    });
  },
});

export const decompileWasmModule = defineTool({
  name: 'decompile_wasm_module',
  description: 'Disassemble a Wasm module to WAT using wabt/wasm2wat and summarize function-level behavior.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    moduleId: zod.string().optional(),
    base64: zod.string().optional(),
    artifactPath: zod.string().optional(),
    maxWatChars: zod.number().int().positive().optional(),
    foldExprs: zod.boolean().optional(),
    inlineExport: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const providedSources = [request.params.moduleId, request.params.base64, request.params.artifactPath]
      .filter((value) => typeof value === 'string' && value.length > 0);
    if (providedSources.length === 0) {
      throw new Error('Provide moduleId, base64, or artifactPath.');
    }
    if (providedSources.length > 1) {
      throw new Error('Provide only one of moduleId, base64, or artifactPath.');
    }

    let bytes: Uint8Array;
    let moduleId: string | undefined;
    let hash: string | undefined;

    if (request.params.moduleId) {
      const module = runtime.wasmCollector.getModuleById(request.params.moduleId);
      const storedBytes = runtime.wasmCollector.getModuleBytes(request.params.moduleId);
      if (!module || !storedBytes) {
        throw new Error(`Unknown Wasm module ID: ${request.params.moduleId}`);
      }
      moduleId = module.id;
      hash = module.hash;
      bytes = storedBytes;
    } else if (request.params.base64) {
      bytes = Uint8Array.from(Buffer.from(request.params.base64, 'base64'));
    } else {
      bytes = Uint8Array.from(await readFile(request.params.artifactPath!));
    }

    const decompiled = await runtime.wasmDecompiler.decompile(bytes, {
      moduleId,
      hash,
      foldExprs: request.params.foldExprs,
      inlineExport: request.params.inlineExport,
    });

    appendJson(response, toDecompileSummary(decompiled, request.params.maxWatChars));
  },
});
