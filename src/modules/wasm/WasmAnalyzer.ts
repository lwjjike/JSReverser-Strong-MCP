import type {
  WasmAnalysisOptions,
  WasmAnalysisResult,
  WasmDataSegmentSummary,
  WasmExportEntry,
  WasmExternalKind,
  WasmFunctionFingerprint,
  WasmImportEntry,
  WasmMemoryInfo,
  WasmModuleRecord,
  WasmSectionSummary,
  WasmStringCategory,
  WasmStringSlot,
  WasmValueType,
} from './WasmTypes.js';

interface WasmLimits {
  min: number;
  max?: number;
  shared?: boolean;
}

interface ParsedTypeEntry {
  params: WasmValueType[];
  results: WasmValueType[];
}

interface ParsedModule {
  sections: WasmSectionSummary[];
  imports: WasmImportEntry[];
  exports: WasmExportEntry[];
  memories: WasmMemoryInfo[];
  typeCount: number;
  functionCount: number;
  importFunctionCount: number;
  exportFunctionCount: number;
  tableCount: number;
  globalCount: number;
  dataSegmentCount: number;
  codeBodyCount: number;
  dataSegments: WasmDataSegmentSummary[];
  stringSlots: WasmStringSlot[];
  headerCandidates: WasmStringSlot[];
  keyMaterialCandidates: WasmStringSlot[];
  startFunctionIndex?: number;
}

class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error('Unexpected end of Wasm payload');
    }
    return this.bytes[this.offset++]!;
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error('Unexpected end of Wasm payload');
    }
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readVarUint32(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result >>> 0;
      }
      shift += 7;
      if (shift > 35) {
        throw new Error('Invalid LEB128 integer');
      }
    }
  }

  readUtf8String(): string {
    const length = this.readVarUint32();
    return new TextDecoder().decode(this.readBytes(length));
  }

  skip(length: number): void {
    this.readBytes(length);
  }
}

function decodeValueType(code: number): WasmValueType {
  switch (code) {
    case 0x7f:
      return 'i32';
    case 0x7e:
      return 'i64';
    case 0x7d:
      return 'f32';
    case 0x7c:
      return 'f64';
    case 0x7b:
      return 'v128';
    case 0x70:
      return 'funcref';
    case 0x6f:
      return 'externref';
    default:
      return 'unknown';
  }
}

function decodeExternalKind(code: number): WasmExternalKind {
  switch (code) {
    case 0x00:
      return 'function';
    case 0x01:
      return 'table';
    case 0x02:
      return 'memory';
    case 0x03:
      return 'global';
    case 0x04:
      return 'tag';
    default:
      return 'unknown';
  }
}

function sectionName(id: number, customName?: string): string {
  if (id === 0) {
    return customName ? `custom:${customName}` : 'custom';
  }
  switch (id) {
    case 1:
      return 'type';
    case 2:
      return 'import';
    case 3:
      return 'function';
    case 4:
      return 'table';
    case 5:
      return 'memory';
    case 6:
      return 'global';
    case 7:
      return 'export';
    case 8:
      return 'start';
    case 9:
      return 'element';
    case 10:
      return 'code';
    case 11:
      return 'data';
    case 12:
      return 'data_count';
    case 13:
      return 'tag';
    default:
      return `section_${id}`;
  }
}

function readLimits(reader: ByteReader): WasmLimits {
  const flags = reader.readByte();
  const min = reader.readVarUint32();
  const hasMax = (flags & 0x01) !== 0;
  const shared = (flags & 0x02) !== 0;
  const max = hasMax ? reader.readVarUint32() : undefined;
  return {min, max, shared};
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function maskSensitiveValue(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function looksLikeEncodedMaterial(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 24) {
    return false;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return false;
  }
  if (normalized.length % 4 !== 0) {
    return false;
  }
  if (!/[0-9]/.test(normalized) && !/[+/=]/.test(normalized)) {
    return false;
  }
  return true;
}

function classifyStringValue(value: string): WasmStringCategory {
  const normalized = value.trim();
  if (/^(x-|accept|authorization|content-|referer|origin|user-agent|cookie|sec-)/i.test(normalized)) {
    return 'header-like';
  }
  if (/https?:\/\//i.test(normalized) || /^\/[a-z0-9/_-]+/i.test(normalized)) {
    return 'url-like';
  }
  if ((normalized.startsWith('{') && normalized.endsWith('}')) || normalized.includes('":')) {
    return 'json-like';
  }
  if (/^[0-9a-f]{16,}$/i.test(normalized)) {
    return 'hex-like';
  }
  if (looksLikeEncodedMaterial(normalized)) {
    return 'base64-like';
  }
  if (/(secret|private|signature|token|nonce|hmac|aes|sm4|sm3|sha|md5|passwd|key)/i.test(normalized)) {
    return 'key-material';
  }
  return 'plain-text';
}

function isSensitiveString(value: string, category: WasmStringCategory): boolean {
  if (category === 'key-material' || category === 'base64-like' || category === 'hex-like') {
    return true;
  }
  return /(secret|private|signature|token|nonce|passwd|key)/i.test(value);
}

function isLikelyInterestingString(value: string): boolean {
  if (value.length < 4) {
    return false;
  }
  return /[A-Za-z]/.test(value);
}

function readInitExpr(reader: ByteReader): {offset?: number} {
  const opcode = reader.readByte();
  if (opcode === 0x41) {
    const offset = reader.readVarUint32();
    const end = reader.readByte();
    if (end !== 0x0b) {
      throw new Error('Unsupported data segment init expression');
    }
    return {offset};
  }
  if (opcode === 0x23) {
    reader.readVarUint32();
    const end = reader.readByte();
    if (end !== 0x0b) {
      throw new Error('Unsupported global-based data segment init expression');
    }
    return {};
  }
  while (reader.remaining > 0) {
    const value = reader.readByte();
    if (value === 0x0b) {
      break;
    }
  }
  return {};
}

function extractPrintableRuns(
  bytes: Uint8Array,
  options: {
    source: WasmStringSlot['source'];
    segmentIndex?: number;
    startOffset: number;
    maskSensitiveStrings: boolean;
    maxStringSlots?: number;
  },
): WasmStringSlot[] {
  const slots: WasmStringSlot[] = [];
  let runStart = -1;

  const flush = (end: number) => {
    if (runStart < 0) {
      return;
    }
    const start = runStart;
    const slice = bytes.slice(runStart, end);
    const value = new TextDecoder().decode(slice).trim();
    runStart = -1;
    if (!isLikelyInterestingString(value)) {
      return;
    }
    const category = classifyStringValue(value);
    const masked = options.maskSensitiveStrings && isSensitiveString(value, category);
    slots.push({
      offset: options.startOffset + start,
      length: slice.byteLength,
      source: options.source,
      segmentIndex: options.segmentIndex,
      category,
      value,
      displayValue: masked ? maskSensitiveValue(value) : value,
      masked,
    });
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    const printable = (byte >= 0x20 && byte <= 0x7e) || byte === 0x09;
    if (printable) {
      if (runStart < 0) {
        runStart = index;
      }
      continue;
    }
    if (runStart >= 0 && index - runStart >= 4) {
      flush(index);
      runStart = -1;
    } else {
      runStart = -1;
    }
  }
  if (runStart >= 0 && bytes.length - runStart >= 4) {
    flush(bytes.length);
  }

  const unique = new Map<string, WasmStringSlot>();
  for (const slot of slots) {
    const key = `${slot.offset}:${slot.value}`;
    if (!unique.has(key)) {
      unique.set(key, slot);
    }
  }
  const limited = Array.from(unique.values()).sort((a, b) => a.offset - b.offset);
  if (typeof options.maxStringSlots === 'number' && options.maxStringSlots > 0) {
    return limited.slice(0, options.maxStringSlots);
  }
  return limited;
}

export class WasmAnalyzer {
  analyzeRecord(
    record: Pick<WasmModuleRecord, 'id' | 'hash' | 'size'>,
    bytes: Uint8Array,
    options: WasmAnalysisOptions = {},
  ): WasmAnalysisResult {
    const parsed = this.parseModule(bytes, options);
    const styleHints = this.detectStyleHints(parsed);
    const purposeHints = this.detectPurposeHints(parsed);
    const riskTags = this.detectRiskTags(parsed);
    const fingerprints = this.buildFingerprints(styleHints, purposeHints, parsed);

    return {
      moduleId: record.id,
      hash: record.hash,
      size: record.size,
      sections: parsed.sections,
      imports: parsed.imports,
      exports: parsed.exports,
      memories: parsed.memories,
      functionCount: parsed.functionCount,
      importFunctionCount: parsed.importFunctionCount,
      exportFunctionCount: parsed.exportFunctionCount,
      tableCount: parsed.tableCount,
      globalCount: parsed.globalCount,
      dataSegmentCount: parsed.dataSegmentCount,
      typeCount: parsed.typeCount,
      codeBodyCount: parsed.codeBodyCount,
      startFunctionIndex: parsed.startFunctionIndex,
      dataSegments: parsed.dataSegments,
      stringSlots: parsed.stringSlots,
      headerCandidates: parsed.headerCandidates,
      keyMaterialCandidates: parsed.keyMaterialCandidates,
      styleHints,
      purposeHints,
      riskTags,
      fingerprints,
      summaryLines: this.buildSummaryLines(parsed, styleHints, purposeHints, riskTags, options),
    };
  }

  analyzeBinary(
    bytes: Uint8Array,
    options: WasmAnalysisOptions = {},
  ): Omit<WasmAnalysisResult, 'moduleId' | 'hash' | 'size'> {
    const analysis = this.analyzeRecord(
      {
        id: 'inline-wasm',
        hash: 'inline-wasm',
        size: bytes.byteLength,
      },
      bytes,
      options,
    );
    const {moduleId, hash, size, ...rest} = analysis;
    void moduleId;
    void hash;
    void size;
    return rest;
  }

  private parseModule(bytes: Uint8Array, options: WasmAnalysisOptions): ParsedModule {
    if (bytes.byteLength < 8) {
      throw new Error('Wasm binary is too small');
    }
    const header = Array.from(bytes.slice(0, 4));
    if (header.join(',') !== '0,97,115,109') {
      throw new Error('Invalid Wasm magic header');
    }
    const version = Array.from(bytes.slice(4, 8));
    if (version.join(',') !== '1,0,0,0') {
      throw new Error('Unsupported Wasm binary version');
    }

    const reader = new ByteReader(bytes.slice(8));
    const sections: WasmSectionSummary[] = [];
    const types: ParsedTypeEntry[] = [];
    const functionTypeIndexes: number[] = [];
    const imports: WasmImportEntry[] = [];
    const exports: WasmExportEntry[] = [];
    const memories: WasmMemoryInfo[] = [];
    const dataSegments: WasmDataSegmentSummary[] = [];

    let importFunctionCount = 0;
    let tableCount = 0;
    let globalCount = 0;
    let dataSegmentCount = 0;
    let codeBodyCount = 0;
    let startFunctionIndex: number | undefined;

    while (reader.remaining > 0) {
      const sectionId = reader.readByte();
      const payloadSize = reader.readVarUint32();
      const payloadOffset = reader.position;
      const payload = new ByteReader(reader.readBytes(payloadSize));

      let count: number | undefined;
      let customName: string | undefined;

      switch (sectionId) {
        case 0: {
          if (payload.remaining > 0) {
            customName = payload.readUtf8String();
          }
          break;
        }
        case 1: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const form = payload.readByte();
            if (form !== 0x60) {
              throw new Error(`Unsupported Wasm type form: 0x${form.toString(16)}`);
            }
            const paramCount = payload.readVarUint32();
            const params = Array.from({length: paramCount}, () => decodeValueType(payload.readByte()));
            const resultCount = payload.readVarUint32();
            const results = Array.from({length: resultCount}, () => decodeValueType(payload.readByte()));
            types.push({params, results});
          }
          break;
        }
        case 2: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const moduleName = payload.readUtf8String();
            const name = payload.readUtf8String();
            const kind = decodeExternalKind(payload.readByte());
            if (kind === 'function') {
              const typeIndex = payload.readVarUint32();
              const signature = types[typeIndex];
              imports.push({
                module: moduleName,
                name,
                kind,
                typeIndex,
                params: options.includeFunctionSignatures === false ? undefined : signature?.params ?? [],
                results: options.includeFunctionSignatures === false ? undefined : signature?.results ?? [],
              });
              importFunctionCount += 1;
            } else if (kind === 'table') {
              payload.readByte();
              const limits = readLimits(payload);
              imports.push({module: moduleName, name, kind, limits});
              tableCount += 1;
            } else if (kind === 'memory') {
              const limits = readLimits(payload);
              imports.push({module: moduleName, name, kind, limits});
              memories.push({
                minPages: limits.min,
                maxPages: limits.max,
                shared: limits.shared,
                exportedName: name,
              });
            } else if (kind === 'global') {
              const valueType = decodeValueType(payload.readByte());
              const mutable = payload.readByte() === 0x01;
              imports.push({module: moduleName, name, kind, valueType, mutable});
              globalCount += 1;
            } else if (kind === 'tag') {
              payload.readByte();
              const typeIndex = payload.readVarUint32();
              imports.push({module: moduleName, name, kind, typeIndex});
            }
          }
          break;
        }
        case 3: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            functionTypeIndexes.push(payload.readVarUint32());
          }
          break;
        }
        case 4: {
          count = payload.readVarUint32();
          tableCount += count;
          break;
        }
        case 5: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const limits = readLimits(payload);
            memories.push({
              minPages: limits.min,
              maxPages: limits.max,
              shared: limits.shared,
            });
          }
          break;
        }
        case 6: {
          count = payload.readVarUint32();
          globalCount += count;
          break;
        }
        case 7: {
          count = payload.readVarUint32();
          for (let i = 0; i < count; i += 1) {
            const name = payload.readUtf8String();
            const kind = decodeExternalKind(payload.readByte());
            const index = payload.readVarUint32();
            if (kind === 'memory') {
              const memory = memories[index] ?? {minPages: 0};
              memory.exportedName = name;
              memories[index] = memory;
            }
            let params: WasmValueType[] | undefined;
            let results: WasmValueType[] | undefined;
            if (kind === 'function' && options.includeFunctionSignatures !== false) {
              const localIndex = index - importFunctionCount;
              const typeIndex = localIndex >= 0 ? functionTypeIndexes[localIndex] : imports[index]?.typeIndex;
              const signature = typeof typeIndex === 'number' ? types[typeIndex] : undefined;
              params = signature?.params ?? [];
              results = signature?.results ?? [];
            }
            exports.push({name, kind, index, params, results});
          }
          break;
        }
        case 8: {
          startFunctionIndex = payload.readVarUint32();
          count = 1;
          break;
        }
        case 9: {
          count = payload.readVarUint32();
          break;
        }
        case 10: {
          count = payload.readVarUint32();
          codeBodyCount = count;
          break;
        }
        case 11: {
          count = payload.readVarUint32();
          dataSegmentCount = count;
          for (let index = 0; index < count; index += 1) {
            const flag = payload.readVarUint32();
            let mode: WasmDataSegmentSummary['mode'] = 'unknown';
            let offset: number | undefined;
            if (flag === 0) {
              mode = 'active';
              offset = readInitExpr(payload).offset;
            } else if (flag === 1) {
              mode = 'passive';
            } else if (flag === 2) {
              mode = 'active-with-memory-index';
              payload.readVarUint32();
              offset = readInitExpr(payload).offset;
            }
            const size = payload.readVarUint32();
            const segmentBytes = payload.readBytes(size);
            const stringSlots = options.includeStringScan === false
              ? []
              : extractPrintableRuns(segmentBytes, {
                  source: 'data-segment',
                  segmentIndex: index,
                  startOffset: offset ?? 0,
                  maskSensitiveStrings: options.maskSensitiveStrings !== false,
                  maxStringSlots: options.maxStringSlots,
                });
            dataSegments.push({
              index,
              mode,
              size,
              offset,
              stringSlots,
            });
          }
          break;
        }
        case 12: {
          count = payload.readVarUint32();
          dataSegmentCount = count;
          break;
        }
        case 13: {
          count = payload.readVarUint32();
          break;
        }
        default:
          break;
      }

      sections.push({
        id: sectionId,
        name: sectionName(sectionId, customName),
        size: payloadSize,
        count,
        offset: payloadOffset + 8,
      });
    }

    const exportFunctionCount = exports.filter((entry) => entry.kind === 'function').length;
    const dataStringSlots = dataSegments.flatMap((segment) => segment.stringSlots);
    const binaryStringSlots = options.includeStringScan === false
      ? []
      : extractPrintableRuns(bytes, {
          source: 'binary-run',
          startOffset: 0,
          maskSensitiveStrings: options.maskSensitiveStrings !== false,
          maxStringSlots: typeof options.maxStringSlots === 'number' ? options.maxStringSlots * 2 : undefined,
        }).filter((slot) =>
          !dataStringSlots.some((existing) => existing.value === slot.value && existing.offset === slot.offset),
        );
    const stringSlots = [...dataStringSlots, ...binaryStringSlots]
      .sort((a, b) => a.offset - b.offset)
      .slice(0, options.maxStringSlots && options.maxStringSlots > 0 ? options.maxStringSlots : undefined);
    const headerCandidates = stringSlots.filter((slot) => slot.category === 'header-like' || slot.category === 'url-like');
    const keyMaterialCandidates = stringSlots.filter((slot) =>
      slot.category === 'key-material' || slot.category === 'base64-like' || slot.category === 'hex-like',
    );
    return {
      sections,
      imports,
      exports,
      memories,
      typeCount: types.length,
      functionCount: importFunctionCount + functionTypeIndexes.length,
      importFunctionCount,
      exportFunctionCount,
      tableCount,
      globalCount,
      dataSegmentCount,
      codeBodyCount,
      dataSegments,
      stringSlots,
      headerCandidates,
      keyMaterialCandidates,
      startFunctionIndex,
    };
  }

  private detectStyleHints(parsed: ParsedModule): string[] {
    const importNames = parsed.imports.map((item) => `${item.module}.${item.name}`);
    const exportNames = parsed.exports.map((item) => item.name);

    const hints: string[] = [];
    if (
      importNames.some((value) => value.startsWith('wbg.')) ||
      exportNames.some((value) => value.startsWith('__wbindgen_'))
    ) {
      hints.push('Rust + wasm-bindgen glue');
    }
    if (
      exportNames.some((value) => ['_malloc', '_free', 'stackSave', 'stackAlloc', 'stackRestore'].includes(value)) ||
      importNames.some((value) => value.includes('__memory_base') || value.includes('__table_base'))
    ) {
      hints.push('Emscripten-style runtime');
    }
    if (exportNames.some((value) => ['run', 'resume', 'getsp'].includes(value))) {
      hints.push('TinyGo-style runtime');
    }
    if (exportNames.some((value) => ['__new', '__pin', '__unpin', '__collect'].includes(value))) {
      hints.push('AssemblyScript-style runtime');
    }
    if (parsed.imports.length >= 8) {
      hints.push('Host bridge is relatively heavy');
    }
    return uniqueStrings(hints);
  }

  private detectPurposeHints(parsed: ParsedModule): string[] {
    const names = [
      ...parsed.imports.map((item) => `${item.module}.${item.name}`),
      ...parsed.exports.map((item) => item.name),
      ...parsed.headerCandidates.map((slot) => slot.value),
      ...parsed.keyMaterialCandidates.map((slot) => slot.value),
    ].map((value) => value.toLowerCase());

    const hints: string[] = [];
    if (names.some((value) => /(md5|sha|sm3|sm4|aes|des|hmac|sign|encrypt|decrypt|nonce|token)/.test(value))) {
      hints.push('Looks crypto/signature related');
    }
    if (names.some((value) => /(gzip|brotli|deflate|inflate|lz|compress|decode|encode)/.test(value))) {
      hints.push('Looks compression/encoding related');
    }
    if (names.some((value) => /(image|pixel|rgba|opus|aac|mp4|video|audio)/.test(value))) {
      hints.push('Looks media processing related');
    }
    if (names.some((value) => /(vm|dispatch|opcode|interpreter|bytecode|eval)/.test(value))) {
      hints.push('Looks virtual-machine / interpreter related');
    }
    if (parsed.memories.length > 0 && parsed.exports.filter((item) => item.kind === 'function').length <= 3) {
      hints.push('Few public entry points with explicit memory bridge');
    }
    if (parsed.headerCandidates.some((slot) => /(signature|authorization|token)/i.test(slot.value))) {
      hints.push('Embedded request/header constants detected');
    }
    return uniqueStrings(hints);
  }

  private detectRiskTags(parsed: ParsedModule): string[] {
    const tags: string[] = [];
    if (parsed.memories.length > 0) {
      tags.push('memory-bridge');
    }
    if (parsed.imports.length >= 10) {
      tags.push('host-coupling');
    }
    if (parsed.exports.filter((entry) => entry.kind === 'function').length >= 20) {
      tags.push('dense-export-surface');
    }
    if (parsed.startFunctionIndex !== undefined) {
      tags.push('has-start-function');
    }
    if (parsed.tableCount > 0) {
      tags.push('indirect-calls');
    }
    if (parsed.keyMaterialCandidates.length > 0) {
      tags.push('embedded-key-material');
    }
    return uniqueStrings(tags);
  }

  private buildFingerprints(
    styleHints: string[],
    purposeHints: string[],
    parsed: ParsedModule,
  ): WasmFunctionFingerprint[] {
    const fingerprints: WasmFunctionFingerprint[] = [];
    if (styleHints.includes('Rust + wasm-bindgen glue')) {
      fingerprints.push({
        family: 'rust-wasm-bindgen',
        confidence: 0.95,
        reason: 'Detected wbg imports / __wbindgen_* exports',
      });
    }
    if (styleHints.includes('Emscripten-style runtime')) {
      fingerprints.push({
        family: 'emscripten',
        confidence: 0.92,
        reason: 'Detected Emscripten allocator / stack exports or env bases',
      });
    }
    if (styleHints.includes('TinyGo-style runtime')) {
      fingerprints.push({
        family: 'tinygo',
        confidence: 0.8,
        reason: 'Detected TinyGo run/resume/getsp export pattern',
      });
    }
    if (styleHints.includes('AssemblyScript-style runtime')) {
      fingerprints.push({
        family: 'assemblyscript',
        confidence: 0.86,
        reason: 'Detected AssemblyScript runtime helper exports',
      });
    }
    if (purposeHints.includes('Looks crypto/signature related')) {
      fingerprints.push({
        family: 'crypto-likely',
        confidence: 0.78,
        reason: 'Import/export naming suggests hashing, signing, or encryption',
      });
    }
    if (purposeHints.includes('Looks compression/encoding related')) {
      fingerprints.push({
        family: 'compression-likely',
        confidence: 0.72,
        reason: 'Import/export naming suggests compression or encoding work',
      });
    }
    if (purposeHints.includes('Looks virtual-machine / interpreter related') || parsed.tableCount > 0) {
      fingerprints.push({
        family: 'vm-likely',
        confidence: purposeHints.includes('Looks virtual-machine / interpreter related') ? 0.74 : 0.56,
        reason: 'Indirect-call table or dispatcher-like symbol names detected',
      });
    }
    if (styleHints.includes('Host bridge is relatively heavy')) {
      fingerprints.push({
        family: 'host-bridge-heavy',
        confidence: 0.68,
        reason: 'Module depends on many host imports and likely thin JS glue',
      });
    }
    if (fingerprints.length === 0) {
      fingerprints.push({
        family: 'unknown',
        confidence: 0.2,
        reason: 'No strong Wasm ecosystem fingerprint detected',
      });
    }
    return fingerprints;
  }

  private buildSummaryLines(
    parsed: ParsedModule,
    styleHints: string[],
    purposeHints: string[],
    riskTags: string[],
    options: WasmAnalysisOptions,
  ): string[] {
    const lines = [
      `Sections: ${parsed.sections.map((section) => section.name).join(', ') || 'none'}`,
      `Functions: ${parsed.functionCount} total (${parsed.importFunctionCount} imported, ${parsed.exportFunctionCount} exported)`,
      `Imports/Exports: ${parsed.imports.length}/${parsed.exports.length}`,
      `Memories/Tables/Globals: ${parsed.memories.length}/${parsed.tableCount}/${parsed.globalCount}`,
      `Data segments: ${parsed.dataSegmentCount}; code bodies: ${parsed.codeBodyCount}`,
      `String slots: ${parsed.stringSlots.length}; header-like: ${parsed.headerCandidates.length}; key-like: ${parsed.keyMaterialCandidates.length}`,
      parsed.headerCandidates.length > 0
        ? `Header/data hints: ${parsed.headerCandidates.slice(0, 4).map((slot) => slot.displayValue).join('; ')}`
        : 'Header/data hints: none',
      parsed.keyMaterialCandidates.length > 0
        ? `Sensitive string hints: ${parsed.keyMaterialCandidates.slice(0, 4).map((slot) => slot.displayValue).join('; ')}`
        : 'Sensitive string hints: none',
      styleHints.length > 0 ? `Style hints: ${styleHints.join('; ')}` : 'Style hints: none',
      purposeHints.length > 0 ? `Purpose hints: ${purposeHints.join('; ')}` : 'Purpose hints: none',
      riskTags.length > 0 ? `Risk tags: ${riskTags.join(', ')}` : 'Risk tags: none',
    ];
    if (typeof options.maxSummaryLines === 'number' && options.maxSummaryLines > 0) {
      return lines.slice(0, options.maxSummaryLines);
    }
    return lines;
  }
}
