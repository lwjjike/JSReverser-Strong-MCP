import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {HTTPResponse, Page} from 'puppeteer';

import type {ReverseTaskHandle} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {PageController} from '../collector/PageController.js';

import {WasmAnalyzer} from './WasmAnalyzer.js';
import {WasmRuntimeInspector} from './WasmRuntimeInspector.js';
import type {
  WasmDetectionResult,
  WasmLoadMethod,
  WasmModuleRecord,
  WasmRuntimeEvent,
  WasmRuntimeModuleCapture,
} from './WasmTypes.js';

interface CollectWasmOptions {
  url: string;
  timeout?: number;
  waitAfterLoadMs?: number;
  includeRuntimeEvents?: boolean;
  maxModules?: number;
  captureBase64?: boolean;
}

interface NetworkCaptureEntry {
  url: string;
  contentType?: string;
  bytes: Uint8Array;
  timestamp: number;
}

interface PageRuntimeCaptureState {
  modules?: WasmRuntimeModuleCapture[];
  events?: Array<Omit<WasmRuntimeEvent, 'moduleId'> & {moduleId?: string}>;
}

interface RegisterBinaryOptions {
  sourceUrl?: string;
  contentType?: string;
  loadMethod: WasmLoadMethod;
  timestamp: number;
  runtimeModuleId?: string;
  source: 'network' | 'runtime';
  captureBase64?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_AFTER_LOAD_MS = 1000;
const DEFAULT_MAX_MODULES = 20;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isWasmBinary(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  );
}

function createWasmHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createModuleId(hash: string): string {
  return `wasm_${hash.slice(0, 12)}`;
}

function mergeOrigin(
  current: WasmModuleRecord['origin'],
  incoming: WasmModuleRecord['origin'],
): WasmModuleRecord['origin'] {
  if (current === incoming) {
    return current;
  }
  return 'hybrid';
}

function sortModules(modules: WasmModuleRecord[]): WasmModuleRecord[] {
  return [...modules].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id));
}

function cloneModuleRecord(record: WasmModuleRecord): WasmModuleRecord {
  return {
    ...record,
    loadMethods: [...record.loadMethods],
    imports: record.imports.map((entry) => ({...entry})),
    exports: record.exports.map((entry) => ({...entry})),
    memories: record.memories.map((entry) => ({...entry})),
    sections: record.sections.map((entry) => ({...entry})),
    runtimeModuleIds: [...record.runtimeModuleIds],
    fingerprints: record.fingerprints.map((entry) => ({...entry})),
    styleHints: [...record.styleHints],
    riskTags: [...record.riskTags],
    purposeHints: [...record.purposeHints],
  };
}

function cloneRuntimeEvent(event: WasmRuntimeEvent): WasmRuntimeEvent {
  return {
    ...event,
    importKeys: event.importKeys ? [...event.importKeys] : undefined,
    exportKeys: event.exportKeys ? [...event.exportKeys] : undefined,
    requestHeaders: event.requestHeaders ? event.requestHeaders.map((entry) => ({...entry})) : undefined,
    bodySegments: event.bodySegments ? event.bodySegments.map((entry) => ({...entry})) : undefined,
    argsPreview: event.argsPreview ? [...event.argsPreview] : undefined,
    stackSummary: event.stackSummary ? [...event.stackSummary] : undefined,
    memory: event.memory ? event.memory.map((entry) => ({...entry})) : undefined,
    resultEntries: event.resultEntries ? event.resultEntries.map((entry) => ({...entry})) : undefined,
    sideEffectHints: event.sideEffectHints ? [...event.sideEffectHints] : undefined,
  };
}

export class WasmCollector {
  private readonly modulesById = new Map<string, WasmModuleRecord>();
  private readonly moduleIdsByHash = new Map<string, string>();
  private readonly bytesByModuleId = new Map<string, Uint8Array>();
  private readonly runtimeEvents: WasmRuntimeEvent[] = [];

  constructor(
    private readonly pageController: PageController,
    private readonly analyzer: WasmAnalyzer,
    private readonly runtimeInspector: WasmRuntimeInspector,
  ) {}

  async collect(
    options: CollectWasmOptions,
    task?: ReverseTaskHandle,
  ): Promise<WasmDetectionResult> {
    const page = await this.pageController.getPage();
    const captureBase64 = options.captureBase64 ?? false;
    const runtimeEnabled = options.includeRuntimeEvents !== false;
    const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const waitAfterLoadMs = options.waitAfterLoadMs ?? DEFAULT_WAIT_AFTER_LOAD_MS;
    const networkEntries: NetworkCaptureEntry[] = [];
    const pendingResponseCaptures = new Set<Promise<void>>();

    await this.pageController.injectScriptOnNewDocument(this.buildPreloadScript());

    const handleResponse = (response: HTTPResponse) => {
      const capture = this.captureNetworkResponse(response, networkEntries);
      pendingResponseCaptures.add(capture);
      void capture.finally(() => pendingResponseCaptures.delete(capture));
    };

    page.on('response', handleResponse);
    try {
      await page.goto(options.url, {
        waitUntil: 'networkidle2',
        timeout,
      });
      if (waitAfterLoadMs > 0) {
        await wait(waitAfterLoadMs);
      }
      await Promise.allSettled(Array.from(pendingResponseCaptures));

      const runtimeState = runtimeEnabled
        ? await this.readRuntimeCaptureState(page)
        : {modules: [], events: []};

      const runtimeModuleIds = new Map<string, string>();

      for (const entry of networkEntries) {
        const record = this.registerBinary(entry.bytes, {
          sourceUrl: entry.url,
          contentType: entry.contentType,
          loadMethod: 'network',
          timestamp: entry.timestamp,
          source: 'network',
          captureBase64,
        });
        if (captureBase64 && !record.base64) {
          record.base64 = Buffer.from(entry.bytes).toString('base64');
        }
      }

      for (const moduleCapture of runtimeState.modules ?? []) {
        if (!moduleCapture.base64) {
          continue;
        }
        const bytes = Uint8Array.from(Buffer.from(moduleCapture.base64, 'base64'));
        if (!isWasmBinary(bytes)) {
          continue;
        }
        const record = this.registerBinary(bytes, {
          sourceUrl: moduleCapture.sourceUrl,
          loadMethod: moduleCapture.loadMethod,
          timestamp: moduleCapture.timestamp,
          runtimeModuleId: moduleCapture.runtimeModuleId,
          source: 'runtime',
          captureBase64,
        });
        runtimeModuleIds.set(moduleCapture.runtimeModuleId, record.id);
      }

      for (const event of runtimeState.events ?? []) {
        const normalized = cloneRuntimeEvent({
          ...event,
          moduleId: event.moduleId ?? (event.runtimeModuleId ? runtimeModuleIds.get(event.runtimeModuleId) : undefined),
        });
        this.runtimeEvents.push(normalized);
      }

      this.applyExportCallCounts();

      const modules = sortModules(Array.from(this.modulesById.values()));
      const selectedModules = modules.slice(0, maxModules);
      const selectedIds = new Set(selectedModules.map((module) => module.id));
      const selectedEvents = this.runtimeEvents.filter(
        (event) => !event.moduleId || selectedIds.has(event.moduleId),
      );

      let artifacts: WasmDetectionResult['artifacts'];
      if (task) {
        artifacts = await this.persistArtifacts(task, modules, this.runtimeEvents);
      }

      return {
        modules: selectedModules.map((module) => cloneModuleRecord(module)),
        runtimeEvents: selectedEvents.map((event) => cloneRuntimeEvent(event)),
        totalModules: modules.length,
        totalRuntimeEvents: this.runtimeEvents.length,
        collectedAt: new Date().toISOString(),
        artifacts,
      };
    } finally {
      page.off('response', handleResponse);
    }
  }

  getModules(): WasmModuleRecord[] {
    return sortModules(Array.from(this.modulesById.values())).map((module) => cloneModuleRecord(module));
  }

  getModuleById(moduleId: string): WasmModuleRecord | undefined {
    const record = this.modulesById.get(moduleId);
    return record ? cloneModuleRecord(record) : undefined;
  }

  getModuleBytes(moduleId: string): Uint8Array | undefined {
    const bytes = this.bytesByModuleId.get(moduleId);
    return bytes ? Uint8Array.from(bytes) : undefined;
  }

  getRuntimeEvents(moduleId?: string): WasmRuntimeEvent[] {
    return this.runtimeEvents
      .filter((event) => !moduleId || event.moduleId === moduleId)
      .map((event) => cloneRuntimeEvent(event));
  }

  private async captureNetworkResponse(
    response: HTTPResponse,
    sink: NetworkCaptureEntry[],
  ): Promise<void> {
    try {
      const url = response.url();
      const headers = response.headers();
      const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : undefined;
      const looksLikeWasm =
        (contentType?.toLowerCase().includes('application/wasm') ?? false) ||
        url.toLowerCase().endsWith('.wasm');

      if (!looksLikeWasm) {
        return;
      }

      const buffer = await response.buffer();
      const bytes = Uint8Array.from(buffer);
      if (!isWasmBinary(bytes)) {
        logger.debug(`[WasmCollector] Ignored non-wasm response body from ${url}`);
        return;
      }

      sink.push({
        url,
        contentType,
        bytes,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.warn('[WasmCollector] Failed to capture wasm response', error);
    }
  }

  private async readRuntimeCaptureState(page: Page): Promise<PageRuntimeCaptureState> {
    try {
      return await page.evaluate(() => {
        const capture = (globalThis as typeof globalThis & {
          __jshookWasmCapture__?: {
            modules?: unknown[];
            events?: unknown[];
          };
        }).__jshookWasmCapture__;
        if (!capture) {
          return {modules: [], events: []};
        }
        return JSON.parse(JSON.stringify(capture)) as {
          modules: unknown[];
          events: unknown[];
        };
      }) as PageRuntimeCaptureState;
    } catch (error) {
      logger.warn('[WasmCollector] Failed to read runtime capture state', error);
      return {modules: [], events: []};
    }
  }

  private registerBinary(bytes: Uint8Array, options: RegisterBinaryOptions): WasmModuleRecord {
    const hash = createWasmHash(bytes);
    const existingId = this.moduleIdsByHash.get(hash);
    const base64 = options.captureBase64 ? Buffer.from(bytes).toString('base64') : undefined;

    if (existingId) {
      const existing = this.modulesById.get(existingId);
      if (!existing) {
        throw new Error(`Wasm module index is inconsistent for ${existingId}`);
      }
      existing.lastSeenAt = Math.max(existing.lastSeenAt, options.timestamp);
      existing.loadMethods = uniqueValues([...existing.loadMethods, options.loadMethod]);
      existing.origin = mergeOrigin(existing.origin, options.source);
      existing.sourceUrl = existing.sourceUrl ?? options.sourceUrl;
      existing.contentType = existing.contentType ?? options.contentType;
      if (options.runtimeModuleId) {
        existing.runtimeModuleIds = uniqueValues([...existing.runtimeModuleIds, options.runtimeModuleId]);
      }
      if (base64 && !existing.base64) {
        existing.base64 = base64;
      }
      return existing;
    }

    const id = createModuleId(hash);
    const analysis = this.analyzer.analyzeRecord(
      {
        id,
        hash,
        size: bytes.byteLength,
      },
      bytes,
      {
        includeFunctionSignatures: true,
      },
    );

    const record: WasmModuleRecord = {
      id,
      hash,
      size: bytes.byteLength,
      sourceUrl: options.sourceUrl,
      contentType: options.contentType,
      loadMethods: [options.loadMethod],
      firstSeenAt: options.timestamp,
      lastSeenAt: options.timestamp,
      imports: analysis.imports,
      exports: analysis.exports,
      memories: analysis.memories,
      sections: analysis.sections,
      runtimeModuleIds: options.runtimeModuleId ? [options.runtimeModuleId] : [],
      origin: options.source,
      base64,
      artifactPath: undefined,
      fingerprints: analysis.fingerprints,
      styleHints: analysis.styleHints,
      riskTags: analysis.riskTags,
      purposeHints: analysis.purposeHints,
    };

    this.modulesById.set(id, record);
    this.moduleIdsByHash.set(hash, id);
    this.bytesByModuleId.set(id, Uint8Array.from(bytes));
    return record;
  }

  private applyExportCallCounts(): void {
    const counts = new Map<string, number>();
    for (const event of this.runtimeEvents) {
      if (event.type !== 'export_call' || !event.moduleId || !event.exportName) {
        continue;
      }
      const key = `${event.moduleId}::${event.exportName}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const record of this.modulesById.values()) {
      record.exports = record.exports.map((entry) => ({
        ...entry,
        callCount: counts.get(`${record.id}::${entry.name}`) ?? entry.callCount ?? 0,
      }));
    }
  }

  private async persistArtifacts(
    task: ReverseTaskHandle,
    modules: WasmModuleRecord[],
    runtimeEvents: WasmRuntimeEvent[],
  ): Promise<WasmDetectionResult['artifacts']> {
    const rootDir = path.join(task.taskDir, 'wasm');
    const binsDir = path.join(rootDir, 'bins');
    const analysisDir = path.join(rootDir, 'analysis');
    const moduleIndexPath = path.join(rootDir, 'modules.json');
    const runtimeEventsPath = path.join(rootDir, 'runtime-events.jsonl');
    const importsExportsPath = path.join(rootDir, 'imports-exports.json');
    const boundaryReportPath = path.join(rootDir, 'boundary-report.md');
    const boundaryJsonPath = path.join(rootDir, 'boundary-report.json');

    await mkdir(binsDir, {recursive: true});
    await mkdir(analysisDir, {recursive: true});

    for (const module of modules) {
      const bytes = this.bytesByModuleId.get(module.id);
      if (!bytes) {
        continue;
      }

      const binPath = path.join(binsDir, `${module.hash}.wasm`);
      const analysisPath = path.join(analysisDir, `${module.hash}.json`);
      const analysis = this.analyzer.analyzeRecord(
        {
          id: module.id,
          hash: module.hash,
          size: module.size,
        },
        bytes,
        {
          includeFunctionSignatures: true,
        },
      );

      await writeFile(binPath, Buffer.from(bytes));
      await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
      module.artifactPath = binPath;
    }

    const boundaryReport = this.runtimeInspector.buildBoundaryReport(modules, runtimeEvents);
    const boundaryJson = this.runtimeInspector.buildStructuredBoundaryArtifact(modules, runtimeEvents);
    await writeFile(
      moduleIndexPath,
      `${JSON.stringify(modules.map((module) => ({...module, base64: undefined})), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      runtimeEventsPath,
      runtimeEvents.map((event) => JSON.stringify(event)).join('\n') + (runtimeEvents.length > 0 ? '\n' : ''),
      'utf8',
    );
    await writeFile(
      importsExportsPath,
      `${JSON.stringify(
        modules.map((module) => ({
          id: module.id,
          hash: module.hash,
          imports: module.imports,
          exports: module.exports,
          memories: module.memories,
        })),
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(boundaryReportPath, `${boundaryReport}\n`, 'utf8');
    await writeFile(boundaryJsonPath, `${JSON.stringify(boundaryJson, null, 2)}\n`, 'utf8');

    return {
      rootDir,
      moduleIndexPath,
      runtimeEventsPath,
      importsExportsPath,
      boundaryReportPath,
      boundaryJsonPath,
      binsDir,
      analysisDir,
    };
  }

  private buildPreloadScript(): string {
    return `
(() => {
  if (globalThis.__jshookWasmCaptureInstalled__) {
    return;
  }
  globalThis.__jshookWasmCaptureInstalled__ = true;

  const state = globalThis.__jshookWasmCapture__ = globalThis.__jshookWasmCapture__ || {
    modules: [],
    events: [],
    seq: 0,
  };

  const original = {
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
    compile: WebAssembly.compile.bind(WebAssembly),
    compileStreaming: WebAssembly.compileStreaming.bind(WebAssembly),
    instantiate: WebAssembly.instantiate.bind(WebAssembly),
    instantiateStreaming: WebAssembly.instantiateStreaming.bind(WebAssembly),
    moduleImports: WebAssembly.Module.imports.bind(WebAssembly.Module),
    moduleExports: WebAssembly.Module.exports.bind(WebAssembly.Module),
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };

  const moduleRegistry = new WeakMap();
  const trackedBuffers = new WeakMap();
  const trackedViews = new WeakMap();
  const xhrState = new WeakMap();
  let lastWasmActivity = null;

  function nextId(prefix) {
    state.seq += 1;
    return prefix + '_' + Date.now() + '_' + state.seq;
  }

  function takeStack() {
    try {
      return String(new Error().stack || '')
        .split('\\n')
        .slice(2, 8)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function previewValue(value) {
    try {
      if (typeof value === 'string') {
        return value.slice(0, 120);
      }
      if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
        return String(value);
      }
      if (value instanceof URLSearchParams) {
        return value.toString().slice(0, 120);
      }
      if (value instanceof ArrayBuffer) {
        return '[ArrayBuffer ' + value.byteLength + ']';
      }
      if (ArrayBuffer.isView(value)) {
        return '[' + (value.constructor && value.constructor.name ? value.constructor.name : 'TypedArray') + ' ' + value.byteLength + ']';
      }
      return JSON.stringify(value).slice(0, 120);
    } catch {
      return '[unserializable]';
    }
  }

  function maskSensitiveValue(value) {
    if (typeof value !== 'string') {
      return previewValue(value);
    }
    if (value.length <= 8) {
      return value.slice(0, 2) + '***';
    }
    return value.slice(0, 4) + '***' + value.slice(-4);
  }

  function classifyBodyKind(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
      return 'empty';
    }
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      return 'json';
    }
    if (text.includes('=') && text.includes('&')) {
      return 'urlencoded';
    }
    if (/^[0-9a-f]+$/i.test(text) && text.length >= 16) {
      return 'hexish';
    }
    if (/^[A-Za-z0-9+/=_-]+$/.test(text) && text.length >= 16) {
      return 'base64ish';
    }
    return 'plain-text';
  }

  function splitBodySegments(value, bodyKind) {
    if (typeof value !== 'string' || value.length === 0) {
      return [];
    }
    let parts;
    if (bodyKind === 'json') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parts = Object.entries(parsed).map(([key, entryValue]) => key + '=' + previewValue(entryValue));
        }
      } catch {
        parts = [value];
      }
    }
    if (!parts && bodyKind === 'urlencoded') {
      parts = value.split('&');
    }
    if (!parts && value.includes('.')) {
      parts = value.split('.');
    }
    if (!parts && value.includes(':')) {
      parts = value.split(':');
    }
    if (!parts) {
      parts = [value];
    }
    return parts
      .map((part, index) => {
        const raw = String(part).trim();
        if (!raw) {
          return null;
        }
        const classification = classifyBodyKind(raw);
        const likelySignatureMaterial =
          /(sign|signature|token|nonce|digest)/i.test(raw) ||
          classification === 'hexish' ||
          classification === 'base64ish';
        return {
          index,
          raw,
          displayValue: likelySignatureMaterial ? maskSensitiveValue(raw) : raw,
          classification: /^[0-9]+$/.test(raw) ? 'numeric' : classification,
          likelySignatureMaterial,
        };
      })
      .filter(Boolean);
  }

  function normalizeHeaderEntries(headers) {
    try {
      if (!headers) {
        return [];
      }
      const entries = [];
      if (headers instanceof Headers) {
        for (const [name, value] of headers.entries()) {
          entries.push([name, value]);
        }
      } else if (Array.isArray(headers)) {
        for (const entry of headers) {
          if (Array.isArray(entry) && entry.length >= 2) {
            entries.push([String(entry[0]), String(entry[1])]);
          }
        }
      } else if (typeof headers === 'object') {
        for (const [name, value] of Object.entries(headers)) {
          entries.push([String(name), Array.isArray(value) ? value.join(', ') : String(value)]);
        }
      }
      return entries.slice(0, 20).map(([name, value]) => {
        const masked = /(authorization|signature|token|secret|key|cookie)/i.test(name) || String(value).length >= 24;
        return {
          name,
          value: masked ? maskSensitiveValue(String(value)) : previewValue(value),
          masked,
        };
      });
    } catch {
      return [];
    }
  }

  function previewEntries(value) {
    try {
      if (value instanceof Map) {
        return Array.from(value.entries()).slice(0, 12).map(([key, entryValue]) => {
          const keyText = String(key);
          const valueText = previewValue(entryValue);
          const masked = /(authorization|signature|token|secret|key|cookie)/i.test(keyText);
          return {
            key: keyText,
            value: masked ? maskSensitiveValue(valueText) : valueText,
            masked,
          };
        });
      }
      if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
        return Object.entries(value).slice(0, 12).map(([key, entryValue]) => {
          const valueText = previewValue(entryValue);
          const masked = /(authorization|signature|token|secret|key|cookie)/i.test(key);
          return {
            key,
            value: masked ? maskSensitiveValue(valueText) : valueText,
            masked,
          };
        });
      }
      return [];
    } catch {
      return [];
    }
  }

  function setLastWasmActivity(runtimeModuleId, exportName) {
    lastWasmActivity = {
      runtimeModuleId,
      exportName,
      timestamp: Date.now(),
    };
  }

  function trackBuffer(buffer, runtimeModuleId, memoryExportName) {
    if (!buffer || typeof buffer !== 'object') {
      return;
    }
    trackedBuffers.set(buffer, {
      runtimeModuleId,
      memoryExportName,
    });
  }

  function getBufferMeta(buffer) {
    if (!buffer || typeof buffer !== 'object') {
      return null;
    }
    return trackedBuffers.get(buffer) || null;
  }

  function trackView(view, meta) {
    if (!view || typeof view !== 'object') {
      return;
    }
    trackedViews.set(view, meta);
  }

  function getViewMeta(view) {
    if (!view || typeof view !== 'object') {
      return null;
    }
    return trackedViews.get(view) || null;
  }

  function inferRuntimeContext(candidate) {
    if (ArrayBuffer.isView(candidate)) {
      const viewMeta = getViewMeta(candidate);
      if (viewMeta) {
        return viewMeta;
      }
      const bufferMeta = getBufferMeta(candidate.buffer);
      if (bufferMeta) {
        return {
          ...bufferMeta,
          viewType: candidate.constructor && candidate.constructor.name ? candidate.constructor.name : 'TypedArray',
          byteOffset: candidate.byteOffset || 0,
          byteLength: candidate.byteLength || 0,
        };
      }
    }
    if (candidate instanceof ArrayBuffer) {
      return getBufferMeta(candidate);
    }
    if (lastWasmActivity && Date.now() - lastWasmActivity.timestamp <= 2500) {
      return lastWasmActivity;
    }
    return null;
  }

  function recordBridgeEvent(type, context, extra) {
    recordEvent({
      id: nextId(type),
      type,
      timestamp: Date.now(),
      runtimeModuleId: context && context.runtimeModuleId ? context.runtimeModuleId : undefined,
      exportName: context && context.exportName ? context.exportName : undefined,
      memoryExportName: context && context.memoryExportName ? context.memoryExportName : undefined,
      viewType: context && context.viewType ? context.viewType : undefined,
      byteOffset: context && typeof context.byteOffset === 'number' ? context.byteOffset : undefined,
      byteLength: context && typeof context.byteLength === 'number' ? context.byteLength : undefined,
      stackSummary: takeStack(),
      ...extra,
    });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async function normalizeSource(source) {
    if (!source) {
      return null;
    }
    if (source instanceof Response) {
      const clone = source.clone();
      const bytes = new Uint8Array(await clone.arrayBuffer());
      return {
        bytes,
        byteLength: bytes.byteLength,
        base64: bytesToBase64(bytes),
        sourceType: 'response',
        sourceUrl: clone.url || undefined,
      };
    }
    if (source instanceof ArrayBuffer) {
      const bytes = new Uint8Array(source.slice(0));
      return {
        bytes,
        byteLength: bytes.byteLength,
        base64: bytesToBase64(bytes),
        sourceType: 'array-buffer',
      };
    }
    if (ArrayBuffer.isView(source)) {
      const bytes = new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
      return {
        bytes,
        byteLength: bytes.byteLength,
        base64: bytesToBase64(bytes),
        sourceType: source.constructor && source.constructor.name ? source.constructor.name : 'typed-array',
      };
    }
    if (source instanceof original.Module) {
      return moduleRegistry.get(source) || null;
    }
    return null;
  }

  function safeImportKeys(importObject) {
    if (!importObject || typeof importObject !== 'object') {
      return [];
    }
    return Object.keys(importObject);
  }

  function safeModuleImports(module) {
    try {
      return original.moduleImports(module).map((entry) => ({
        module: entry.module,
        name: entry.name,
        kind: entry.kind || 'unknown',
      }));
    } catch {
      return [];
    }
  }

  function safeModuleExports(module) {
    try {
      return original.moduleExports(module).map((entry) => ({
        name: entry.name,
        kind: entry.kind || 'unknown',
      }));
    } catch {
      return [];
    }
  }

  function safeMemory(instance) {
    try {
      return Object.entries(instance && instance.exports ? instance.exports : {})
        .flatMap(([name, value]) => {
          if (value instanceof WebAssembly.Memory) {
            return [{
              minPages: Math.floor(value.buffer.byteLength / 65536),
              exportedName: name,
            }];
          }
          return [];
        });
    } catch {
      return [];
    }
  }

  function wrapMemory(runtimeModuleId, exportedName, memory) {
    trackBuffer(memory.buffer, runtimeModuleId, exportedName);
    return new Proxy(memory, {
      get(target, property, receiver) {
        if (property === 'buffer') {
          const buffer = Reflect.get(target, property, receiver);
          trackBuffer(buffer, runtimeModuleId, exportedName);
          setLastWasmActivity(runtimeModuleId);
          recordBridgeEvent('memory_buffer_access', {
            runtimeModuleId,
            memoryExportName: exportedName,
            byteLength: buffer && typeof buffer.byteLength === 'number' ? buffer.byteLength : undefined,
          }, {
            accessKind: 'buffer',
            sideEffectHints: ['memory-bridge'],
          });
          return buffer;
        }

        if (property === 'grow') {
          return function (...args) {
            setLastWasmActivity(runtimeModuleId);
            return target.grow.apply(target, args);
          };
        }

        return Reflect.get(target, property, receiver);
      },
    });
  }

  function safeExportKeys(instance) {
    try {
      return Object.keys(instance && instance.exports ? instance.exports : {});
    } catch {
      return [];
    }
  }

  function exportCallHints(args, result, instance) {
    const hints = [];
    if (Array.isArray(args) && args.length >= 2 && args.every((value) => typeof value === 'number')) {
      hints.push('ptr-len-shape');
    }
    if (typeof result === 'number') {
      hints.push('numeric-result');
    }
    if (safeMemory(instance).length > 0) {
      hints.push('memory-bridge');
    }
    return hints;
  }

  function wrapInstance(runtimeModuleId, instance) {
    if (!instance || typeof instance !== 'object' || !instance.exports) {
      return instance;
    }

    const originalExports = instance.exports;
    const wrappedExports = {};

    for (const [name, value] of Object.entries(originalExports)) {
      if (value instanceof WebAssembly.Memory) {
        wrappedExports[name] = wrapMemory(runtimeModuleId, name, value);
        continue;
      }
      if (typeof value !== 'function') {
        wrappedExports[name] = value;
        continue;
      }

      wrappedExports[name] = function (...args) {
        setLastWasmActivity(runtimeModuleId, name);
        const result = value.apply(this, args);
        state.events.push({
          id: nextId('export_call'),
          type: 'export_call',
          timestamp: Date.now(),
          runtimeModuleId,
          exportName: name,
          argsPreview: args.map((item) => previewValue(item)).slice(0, 6),
          resultPreview: previewValue(result),
          resultEntries: previewEntries(result),
          stackSummary: takeStack(),
          sideEffectHints: exportCallHints(args, result, instance),
        });
        setLastWasmActivity(runtimeModuleId, name);
        return result;
      };
    }

    return new Proxy(instance, {
      get(target, property, receiver) {
        if (property === 'exports') {
          return wrappedExports;
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  function recordModule(payload) {
    state.modules.push(payload);
  }

  function recordEvent(payload) {
    state.events.push(payload);
  }

  function installTypedArrayTracking() {
    const typedArrayNames = [
      'Int8Array',
      'Uint8Array',
      'Uint8ClampedArray',
      'Int16Array',
      'Uint16Array',
      'Int32Array',
      'Uint32Array',
      'Float32Array',
      'Float64Array',
      'BigInt64Array',
      'BigUint64Array',
    ];

    for (const name of typedArrayNames) {
      const Original = globalThis[name];
      if (typeof Original !== 'function') {
        continue;
      }

      globalThis[name] = new Proxy(Original, {
        construct(target, args, newTarget) {
          const instance = Reflect.construct(target, args, newTarget);
          const context = inferRuntimeContext(args[0]);
          if (context) {
            const meta = {
              runtimeModuleId: context.runtimeModuleId,
              exportName: context.exportName,
              memoryExportName: context.memoryExportName,
              viewType: name,
              byteOffset: typeof args[1] === 'number' ? args[1] : instance.byteOffset || 0,
              byteLength: typeof instance.byteLength === 'number' ? instance.byteLength : undefined,
            };
            trackView(instance, meta);
            setLastWasmActivity(context.runtimeModuleId, context.exportName);
            recordBridgeEvent('memory_view_create', meta, {
              accessKind: 'create',
              sideEffectHints: ['memory-bridge'],
            });
          }
          return instance;
        },
      });

      if (typeof Original.prototype?.set === 'function') {
        const originalSet = Original.prototype.set;
        Original.prototype.set = function (...args) {
          const meta = getViewMeta(this);
          if (meta) {
            setLastWasmActivity(meta.runtimeModuleId, meta.exportName);
            recordBridgeEvent('memory_write', meta, {
              accessKind: 'write',
              argsPreview: args.map((item) => previewValue(item)).slice(0, 4),
              sideEffectHints: ['typed-array-set'],
            });
          }
          return originalSet.apply(this, args);
        };
      }

      if (typeof Original.prototype?.fill === 'function') {
        const originalFill = Original.prototype.fill;
        Original.prototype.fill = function (...args) {
          const meta = getViewMeta(this);
          if (meta) {
            setLastWasmActivity(meta.runtimeModuleId, meta.exportName);
            recordBridgeEvent('memory_write', meta, {
              accessKind: 'write',
              argsPreview: args.map((item) => previewValue(item)).slice(0, 3),
              sideEffectHints: ['typed-array-fill'],
            });
          }
          return originalFill.apply(this, args);
        };
      }

      if (typeof Original.prototype?.copyWithin === 'function') {
        const originalCopyWithin = Original.prototype.copyWithin;
        Original.prototype.copyWithin = function (...args) {
          const meta = getViewMeta(this);
          if (meta) {
            setLastWasmActivity(meta.runtimeModuleId, meta.exportName);
            recordBridgeEvent('memory_write', meta, {
              accessKind: 'write',
              argsPreview: args.map((item) => previewValue(item)).slice(0, 3),
              sideEffectHints: ['typed-array-copyWithin'],
            });
          }
          return originalCopyWithin.apply(this, args);
        };
      }
    }

    if (typeof globalThis.DataView === 'function') {
      const OriginalDataView = globalThis.DataView;
      globalThis.DataView = new Proxy(OriginalDataView, {
        construct(target, args, newTarget) {
          const instance = Reflect.construct(target, args, newTarget);
          const context = inferRuntimeContext(args[0]);
          if (context) {
            const meta = {
              runtimeModuleId: context.runtimeModuleId,
              exportName: context.exportName,
              memoryExportName: context.memoryExportName,
              viewType: 'DataView',
              byteOffset: typeof args[1] === 'number' ? args[1] : instance.byteOffset || 0,
              byteLength: typeof instance.byteLength === 'number' ? instance.byteLength : undefined,
            };
            trackView(instance, meta);
            setLastWasmActivity(context.runtimeModuleId, context.exportName);
            recordBridgeEvent('memory_view_create', meta, {
              accessKind: 'create',
              sideEffectHints: ['memory-bridge'],
            });
          }
          return instance;
        },
      });

      const readMethods = ['getInt8', 'getUint8', 'getInt16', 'getUint16', 'getInt32', 'getUint32', 'getFloat32', 'getFloat64', 'getBigInt64', 'getBigUint64'];
      const writeMethods = ['setInt8', 'setUint8', 'setInt16', 'setUint16', 'setInt32', 'setUint32', 'setFloat32', 'setFloat64', 'setBigInt64', 'setBigUint64'];

      for (const method of readMethods) {
        if (typeof OriginalDataView.prototype[method] !== 'function') {
          continue;
        }
        const originalMethod = OriginalDataView.prototype[method];
        OriginalDataView.prototype[method] = function (...args) {
          const meta = getViewMeta(this);
          if (meta) {
            setLastWasmActivity(meta.runtimeModuleId, meta.exportName);
            recordBridgeEvent('memory_read', meta, {
              accessKind: 'read',
              argsPreview: args.map((item) => previewValue(item)).slice(0, 2),
              sideEffectHints: ['data-view-read'],
            });
          }
          return originalMethod.apply(this, args);
        };
      }

      for (const method of writeMethods) {
        if (typeof OriginalDataView.prototype[method] !== 'function') {
          continue;
        }
        const originalMethod = OriginalDataView.prototype[method];
        OriginalDataView.prototype[method] = function (...args) {
          const meta = getViewMeta(this);
          if (meta) {
            setLastWasmActivity(meta.runtimeModuleId, meta.exportName);
            recordBridgeEvent('memory_write', meta, {
              accessKind: 'write',
              argsPreview: args.map((item) => previewValue(item)).slice(0, 3),
              sideEffectHints: ['data-view-write'],
            });
          }
          return originalMethod.apply(this, args);
        };
      }
    }
  }

  function installTextCodecTracking() {
    if (typeof original.TextEncoder === 'function' && typeof original.TextEncoder.prototype?.encodeInto === 'function') {
      const originalEncodeInto = original.TextEncoder.prototype.encodeInto;
      original.TextEncoder.prototype.encodeInto = function (input, destination) {
        const context = inferRuntimeContext(destination);
        if (context) {
          setLastWasmActivity(context.runtimeModuleId, context.exportName);
          recordBridgeEvent('text_encode', {
            ...context,
            viewType: destination && destination.constructor ? destination.constructor.name : context.viewType,
            byteOffset: destination && typeof destination.byteOffset === 'number' ? destination.byteOffset : context.byteOffset,
            byteLength: destination && typeof destination.byteLength === 'number' ? destination.byteLength : context.byteLength,
          }, {
            accessKind: 'write',
            argsPreview: [previewValue(input)],
            sideEffectHints: ['text-encode-into-memory'],
          });
        }
        return originalEncodeInto.call(this, input, destination);
      };
    }

    if (typeof original.TextDecoder === 'function' && typeof original.TextDecoder.prototype?.decode === 'function') {
      const originalDecode = original.TextDecoder.prototype.decode;
      original.TextDecoder.prototype.decode = function (input, options) {
        const context = inferRuntimeContext(input);
        if (context) {
          setLastWasmActivity(context.runtimeModuleId, context.exportName);
          recordBridgeEvent('text_decode', {
            ...context,
            viewType: input && input.constructor ? input.constructor.name : context.viewType,
            byteOffset: input && typeof input.byteOffset === 'number' ? input.byteOffset : context.byteOffset,
            byteLength: input && typeof input.byteLength === 'number' ? input.byteLength : context.byteLength,
          }, {
            accessKind: 'read',
            argsPreview: options ? [previewValue(options)] : undefined,
            sideEffectHints: ['text-decode-from-memory'],
          });
        }
        return originalDecode.call(this, input, options);
      };
    }
  }

  function installNetworkTracking() {
    if (typeof original.fetch === 'function') {
      globalThis.fetch = function (input, init) {
        const requestUrl =
          typeof input === 'string'
            ? input
            : (input && typeof input.url === 'string' ? input.url : undefined);
        const requestMethod =
          (init && init.method) ||
          (input && typeof input.method === 'string' ? input.method : undefined) ||
          'GET';
        const requestBody = init ? init.body : undefined;
        const requestHeaders = normalizeHeaderEntries(
          init && init.headers
            ? init.headers
            : (input && typeof input.headers === 'object' ? input.headers : undefined),
        );
        const bodySnippet = previewValue(requestBody);
        const bodyKind = classifyBodyKind(typeof requestBody === 'string' ? requestBody : bodySnippet);
        const context = inferRuntimeContext(requestBody);
        if (context) {
          setLastWasmActivity(context.runtimeModuleId, context.exportName);
        }
        recordBridgeEvent('network_request', context, {
          method: requestMethod,
          url: requestUrl,
          bodySnippet,
          bodyKind,
          bodySegments: splitBodySegments(typeof requestBody === 'string' ? requestBody : bodySnippet, bodyKind),
          requestHeaders,
          sideEffectHints: [
            'fetch',
            bodyKind !== 'empty' ? 'body-observed' : undefined,
            ...(context ? ['post-wasm-activity'] : []),
          ].filter(Boolean),
        });
        return original.fetch.apply(this, arguments);
      };
    }

    if (typeof original.XMLHttpRequest === 'function') {
      const proto = original.XMLHttpRequest.prototype;
      if (typeof proto.open === 'function') {
        const originalOpen = proto.open;
        proto.open = function (method, url) {
          xhrState.set(this, {method, url, headers: []});
          return originalOpen.apply(this, arguments);
        };
      }
      if (typeof proto.setRequestHeader === 'function') {
        const originalSetRequestHeader = proto.setRequestHeader;
        proto.setRequestHeader = function (name, value) {
          const info = xhrState.get(this) || {headers: []};
          info.headers = info.headers || [];
          info.headers.push([String(name), String(value)]);
          xhrState.set(this, info);
          return originalSetRequestHeader.apply(this, arguments);
        };
      }
      if (typeof proto.send === 'function') {
        const originalSend = proto.send;
        proto.send = function (body) {
          const info = xhrState.get(this) || {};
          const context = inferRuntimeContext(body);
          const bodySnippet = previewValue(body);
          const bodyKind = classifyBodyKind(typeof body === 'string' ? body : bodySnippet);
          if (context) {
            setLastWasmActivity(context.runtimeModuleId, context.exportName);
          }
          recordBridgeEvent('network_request', context, {
            method: info.method || 'GET',
            url: info.url,
            bodySnippet,
            bodyKind,
            bodySegments: splitBodySegments(typeof body === 'string' ? body : bodySnippet, bodyKind),
            requestHeaders: normalizeHeaderEntries(info.headers),
            sideEffectHints: [
              'xhr',
              bodyKind !== 'empty' ? 'body-observed' : undefined,
              ...(context ? ['post-wasm-activity'] : []),
            ].filter(Boolean),
          });
          return originalSend.apply(this, arguments);
        };
      }
    }
  }

  async function rememberModule(loadMethod, source, module, importObject, instance, runtimeModuleIdOverride) {
    const normalized = await normalizeSource(source);
    if (module && normalized) {
      moduleRegistry.set(module, normalized);
    }

    const runtimeModuleId = runtimeModuleIdOverride || nextId('wasm_runtime');
    const moduleImports = module ? safeModuleImports(module) : [];
    const moduleExports = module ? safeModuleExports(module) : [];
    const memory = instance ? safeMemory(instance) : [];

    recordModule({
      runtimeModuleId,
      timestamp: Date.now(),
      loadMethod,
      sourceType: normalized && normalized.sourceType ? normalized.sourceType : undefined,
      sourceUrl: normalized && normalized.sourceUrl ? normalized.sourceUrl : undefined,
      byteLength: normalized && normalized.byteLength ? normalized.byteLength : undefined,
      base64: normalized && normalized.base64 ? normalized.base64 : undefined,
      importKeys: safeImportKeys(importObject),
      exportKeys: instance ? safeExportKeys(instance) : moduleExports.map((entry) => entry.name),
      stackSummary: takeStack(),
      memory,
      moduleImports,
      moduleExports,
    });

    recordEvent({
      id: nextId(loadMethod),
      type: loadMethod,
      timestamp: Date.now(),
      runtimeModuleId,
      loadMethod,
      sourceType: normalized && normalized.sourceType ? normalized.sourceType : undefined,
      importKeys: safeImportKeys(importObject),
      exportKeys: instance ? safeExportKeys(instance) : moduleExports.map((entry) => entry.name),
      stackSummary: takeStack(),
      memory,
      sideEffectHints: [
        ...(memory.length > 0 ? ['memory-bridge'] : []),
        ...(moduleExports.some((entry) => entry.kind === 'table') ? ['table-export'] : []),
      ],
    });

    return runtimeModuleId;
  }

  installTypedArrayTracking();
  installTextCodecTracking();
  installNetworkTracking();

  WebAssembly.Module = new Proxy(original.Module, {
    construct(target, args, newTarget) {
      const module = Reflect.construct(target, args, newTarget);
      Promise.resolve()
        .then(() => rememberModule('module', args[0], module))
        .catch(() => undefined);
      return module;
    },
  });

  WebAssembly.Instance = new Proxy(original.Instance, {
    construct(target, args, newTarget) {
      const instance = Reflect.construct(target, args, newTarget);
      const runtimeModuleId = nextId('wasm_runtime');
      Promise.resolve()
        .then(() => rememberModule('instantiate', args[0], args[0], args[1], instance, runtimeModuleId))
        .catch(() => undefined);
      return wrapInstance(runtimeModuleId, instance);
    },
  });

  WebAssembly.compile = async function (source) {
    const module = await original.compile(source);
    await rememberModule('compile', source, module);
    return module;
  };

  WebAssembly.compileStreaming = async function (source) {
    const module = await original.compileStreaming(source);
    await rememberModule('compileStreaming', source, module);
    return module;
  };

  WebAssembly.instantiate = async function (source, importObject) {
    const result = await original.instantiate(source, importObject);
    const module = result instanceof WebAssembly.Instance ? source : result.module;
    const instance = result instanceof WebAssembly.Instance ? result : result.instance;
    const runtimeModuleId = nextId('wasm_runtime');
    await rememberModule('instantiate', source, module, importObject, instance, runtimeModuleId);
    const wrappedInstance = wrapInstance(runtimeModuleId, instance);
    if (result instanceof WebAssembly.Instance) {
      return wrappedInstance;
    }
    return {
      ...result,
      instance: wrappedInstance,
    };
  };

  WebAssembly.instantiateStreaming = async function (source, importObject) {
    const result = await original.instantiateStreaming(source, importObject);
    const runtimeModuleId = nextId('wasm_runtime');
    await rememberModule('instantiateStreaming', source, result.module, importObject, result.instance, runtimeModuleId);
    return {
      ...result,
      instance: wrapInstance(runtimeModuleId, result.instance),
    };
  };
})();
`;
  }
}
