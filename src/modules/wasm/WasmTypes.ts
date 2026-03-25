export type WasmValueType =
  | 'i32'
  | 'i64'
  | 'f32'
  | 'f64'
  | 'v128'
  | 'funcref'
  | 'externref'
  | 'unknown';

export type WasmExternalKind =
  | 'function'
  | 'table'
  | 'memory'
  | 'global'
  | 'tag'
  | 'unknown';

export type WasmLoadMethod =
  | 'network'
  | 'instantiate'
  | 'instantiateStreaming'
  | 'compile'
  | 'compileStreaming'
  | 'module';

export type WasmRuntimeEventType =
  | 'instantiate'
  | 'instantiateStreaming'
  | 'compile'
  | 'compileStreaming'
  | 'module'
  | 'export_call'
  | 'memory_buffer_access'
  | 'memory_view_create'
  | 'memory_write'
  | 'memory_read'
  | 'text_encode'
  | 'text_decode'
  | 'network_request';

export interface WasmSectionSummary {
  id: number;
  name: string;
  size: number;
  count?: number;
  offset: number;
}

export interface WasmImportEntry {
  module: string;
  name: string;
  kind: WasmExternalKind;
  typeIndex?: number;
  params?: WasmValueType[];
  results?: WasmValueType[];
  limits?: {
    min: number;
    max?: number;
    shared?: boolean;
  };
  valueType?: WasmValueType;
  mutable?: boolean;
}

export interface WasmExportEntry {
  name: string;
  kind: WasmExternalKind;
  index: number;
  params?: WasmValueType[];
  results?: WasmValueType[];
  callCount?: number;
}

export interface WasmMemoryInfo {
  minPages: number;
  maxPages?: number;
  shared?: boolean;
  exportedName?: string;
}

export interface WasmFunctionFingerprint {
  family:
    | 'rust-wasm-bindgen'
    | 'emscripten'
    | 'tinygo'
    | 'assemblyscript'
    | 'crypto-likely'
    | 'compression-likely'
    | 'vm-likely'
    | 'host-bridge-heavy'
    | 'unknown';
  confidence: number;
  reason: string;
}

export interface WasmRuntimeEvent {
  id: string;
  type: WasmRuntimeEventType;
  timestamp: number;
  moduleId?: string;
  runtimeModuleId?: string;
  loadMethod?: WasmLoadMethod;
  sourceType?: string;
  importKeys?: string[];
  exportKeys?: string[];
  exportName?: string;
  memoryExportName?: string;
  viewType?: string;
  accessKind?: 'read' | 'write' | 'create' | 'buffer';
  byteOffset?: number;
  byteLength?: number;
  method?: string;
  url?: string;
  bodySnippet?: string;
  argsPreview?: string[];
  resultPreview?: string;
  stackSummary?: string[];
  memory?: WasmMemoryInfo[];
  sideEffectHints?: string[];
}

export interface WasmBoundaryStep {
  type: WasmRuntimeEventType;
  timestamp: number;
  description: string;
  exportName?: string;
  memoryExportName?: string;
  url?: string;
  method?: string;
  stackSummary?: string[];
}

export interface WasmBoundaryChain {
  moduleId: string;
  runtimeModuleId?: string;
  exportName: string;
  score: number;
  startedAt: number;
  endedAt: number;
  writerHints: string[];
  readerHints: string[];
  sinkHints: string[];
  candidateJsCallers: string[];
  networkTargets: Array<{
    method?: string;
    url?: string;
    bodySnippet?: string;
  }>;
  steps: WasmBoundaryStep[];
}

export interface WasmRuntimeModuleCapture {
  runtimeModuleId: string;
  timestamp: number;
  loadMethod: WasmLoadMethod;
  sourceType?: string;
  sourceUrl?: string;
  byteLength?: number;
  base64?: string;
  importKeys?: string[];
  exportKeys?: string[];
  stackSummary?: string[];
  memory?: WasmMemoryInfo[];
  moduleImports?: Array<{
    module: string;
    name: string;
    kind: WasmExternalKind;
  }>;
  moduleExports?: Array<{
    name: string;
    kind: WasmExternalKind;
  }>;
}

export interface WasmModuleRecord {
  id: string;
  hash: string;
  size: number;
  sourceUrl?: string;
  contentType?: string;
  loadMethods: WasmLoadMethod[];
  firstSeenAt: number;
  lastSeenAt: number;
  imports: WasmImportEntry[];
  exports: WasmExportEntry[];
  memories: WasmMemoryInfo[];
  sections: WasmSectionSummary[];
  runtimeModuleIds: string[];
  origin: 'network' | 'runtime' | 'hybrid';
  base64?: string;
  artifactPath?: string;
  fingerprints: WasmFunctionFingerprint[];
  styleHints: string[];
  riskTags: string[];
  purposeHints: string[];
}

export interface WasmDetectionResult {
  modules: WasmModuleRecord[];
  runtimeEvents: WasmRuntimeEvent[];
  totalModules: number;
  totalRuntimeEvents: number;
  collectedAt: string;
  artifacts?: {
    rootDir?: string;
    moduleIndexPath?: string;
    runtimeEventsPath?: string;
    importsExportsPath?: string;
    boundaryReportPath?: string;
    binsDir?: string;
    analysisDir?: string;
  };
}

export interface WasmAnalysisOptions {
  includeFunctionSignatures?: boolean;
  includeRawSectionMap?: boolean;
  maxSummaryLines?: number;
}

export interface WasmAnalysisResult {
  moduleId: string;
  hash: string;
  size: number;
  sections: WasmSectionSummary[];
  imports: WasmImportEntry[];
  exports: WasmExportEntry[];
  memories: WasmMemoryInfo[];
  functionCount: number;
  importFunctionCount: number;
  exportFunctionCount: number;
  tableCount: number;
  globalCount: number;
  dataSegmentCount: number;
  typeCount: number;
  codeBodyCount: number;
  startFunctionIndex?: number;
  styleHints: string[];
  purposeHints: string[];
  riskTags: string[];
  fingerprints: WasmFunctionFingerprint[];
  summaryLines: string[];
}

export interface WasmFunctionDisassemblySummary {
  name: string;
  index?: number;
  paramCount: number;
  resultCount: number;
  instructionCount: number;
  callCount: number;
  indirectCallCount: number;
  memoryLoadCount: number;
  memoryStoreCount: number;
  localAccessCount: number;
  suspiciousTags: string[];
  preview: string[];
}

export interface WasmDecompileResult {
  moduleId?: string;
  hash?: string;
  size: number;
  wat: string;
  lineCount: number;
  functionCount: number;
  importCount: number;
  exportCount: number;
  functionSummaries: WasmFunctionDisassemblySummary[];
}
