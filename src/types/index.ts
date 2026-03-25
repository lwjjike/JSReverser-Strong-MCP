
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/**
 * 核心类型定义
 */

import type { Browser, Page } from 'puppeteer';

// ==================== 配置类型 ====================

export interface Config {
  llm: LLMConfig;
  puppeteer: PuppeteerConfig;
  mcp: MCPConfig;
  cache: CacheConfig;
  performance: PerformanceConfig;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  openai?: {
    apiKey: string;
    model: string;
    baseURL?: string;
  };
  anthropic?: {
    apiKey: string;
    model: string;
  };
}

export interface PuppeteerConfig {
  headless: boolean;
  timeout: number;
  args?: string[];
  // 🆕 新增可配置项
  viewport?: { width: number; height: number };
  userAgent?: string;
  maxCollectedUrls?: number;
  // 🔧 新增：防止 MCP token 溢出的限制
  maxFilesPerCollect?: number;      // 单次收集最大文件数（默认50）
  maxTotalContentSize?: number;     // 单次返回最大总大小（默认512KB）
  maxSingleFileSize?: number;       // 单个文件最大大小（默认100KB）
  useExternalBrowser?: boolean;
  remoteDebuggingUrl?: string;
  userDataDir?: string;
  useStealthScripts?: boolean;
  reuseEnvironmentPerSession?: boolean;
  autoLaunchExternalBrowser?: boolean;
  externalBrowserPath?: string;
  externalBrowserArgs?: string[];
}

export interface MCPConfig {
  name: string;
  version: string;
}

export interface CacheConfig {
  enabled: boolean;
  dir: string;
  ttl: number;
}

export interface PerformanceConfig {
  maxConcurrentAnalysis: number;
  maxCodeSizeMB: number;
}

// ==================== 代码收集类型 ====================

export interface CollectCodeOptions {
  url: string;
  depth?: number;
  timeout?: number;
  includeInline?: boolean;
  includeExternal?: boolean;
  includeDynamic?: boolean;
  includeServiceWorker?: boolean;
  includeWebWorker?: boolean;
  filterRules?: string[]; // URL过滤规则

  // 🆕 智能收集选项
  smartMode?: 'summary' | 'priority' | 'incremental' | 'full'; // 智能收集模式
  compress?: boolean; // 是否压缩代码
  streaming?: boolean; // 是否流式传输
  maxTotalSize?: number; // 最大总大小（字节）
  maxFileSize?: number; // 单个文件最大大小
  priorities?: string[]; // 优先级URL模式
  dynamicWaitMs?: number; // 动态脚本额外等待时长（毫秒）
}

export interface CodeFile {
  url: string;
  content: string;
  size: number;
  type: 'inline' | 'external' | 'dynamic' | 'service-worker' | 'web-worker';
  loadTime?: number;
  metadata?: Record<string, unknown>; // 额外元数据
}

export interface CollectCodeResult {
  files: CodeFile[];
  dependencies: DependencyGraph;
  totalSize: number;
  collectTime: number;
  summaries?: Array<{
    url: string;
    size: number;
    type: string;
    hasEncryption: boolean;
    hasAPI: boolean;
    hasObfuscation: boolean;
    functions: string[];
    imports: string[];
    preview: string;
  }>; // 🆕 智能收集摘要模式返回
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyNode {
  id: string;
  url: string;
  type: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'require' | 'script';
}

// ==================== 反混淆类型 ====================

export interface DeobfuscateOptions {
  code: string;
  llm?: 'gpt-4' | 'claude';
  aggressive?: boolean; // 启用激进的反混淆（控制流平坦化还原等）
  preserveLogic?: boolean; // 保留原始逻辑
  renameVariables?: boolean; // 重命名变量为有意义的名称
  inlineFunctions?: boolean; // 内联简单函数
}

export interface DeobfuscateResult {
  code: string;
  readabilityScore: number;
  confidence: number;
  obfuscationType: ObfuscationType[];
  transformations: Transformation[];
  analysis: string;

  /**
   * 全部子管线产生的警告/分析信息，外部 AI 可据此做进一步推理
   * 包含：编码机制分析、VM 结构识别、指令映射、LLM 中间分析等
   */
  warnings?: string[];

  /**
   * 未能完全还原的部分，携带位置、原因、建议
   * 外部 AI 可据此决定是否进行针对性的二次分析
   */
  unresolvedParts?: UnresolvedPart[];
}

export type ObfuscationType =
  | 'javascript-obfuscator' // obfuscator.io (最常见)
  | 'webpack' // Webpack打包混淆
  | 'uglify' // UglifyJS压缩
  | 'vm-protection' // VM虚拟机保护
  | 'self-modifying' // 自修改代码
  | 'invisible-unicode' // 不可见Unicode混淆 (2025新技术)
  | 'control-flow-flattening' // 控制流平坦化
  | 'string-array-rotation' // 字符串数组旋转
  | 'dead-code-injection' // 死代码注入
  | 'opaque-predicates' // 不透明谓词
  | 'jsfuck' // JSFuck编码 ([]()!+)
  | 'aaencode' // AAEncode (颜文字编码)
  | 'jjencode' // JJEncode
  | 'packer' // Dean Edwards Packer
  | 'eval-obfuscation' // eval混淆
  | 'base64-encoding' // Base64编码
  | 'hex-encoding' // 十六进制编码
  | 'jscrambler' // JScrambler商业混淆
  | 'urlencoded' // URL编码混淆
  | 'custom' // 自定义/魔改混淆
  | 'unknown';

export interface Transformation {
  type: string;
  description: string;
  success: boolean;
  /** 子管线的详细分析数据，供外部 AI 进一步推理（JSON 可序列化） */
  detail?: Record<string, unknown>;
}

// ==================== 代码理解类型 ====================

export interface UnderstandCodeOptions {
  code: string;
  context?: Record<string, unknown>;
  focus?: 'structure' | 'business' | 'security' | 'all';
}

export interface UnderstandCodeResult {
  structure: CodeStructure;
  techStack: TechStack;
  businessLogic: BusinessLogic;
  dataFlow: DataFlow;
  securityRisks: SecurityRisk[];
  qualityScore: number;
  // 新增字段 - 代码模式和复杂度分析
  codePatterns?: Array<{
    name: string;
    location: number;
    description: string;
  }>;
  antiPatterns?: Array<{
    name: string;
    location: number;
    severity: string;
    recommendation: string;
  }>;
  complexityMetrics?: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
    halsteadMetrics: {
      vocabulary: number;
      length: number;
      difficulty: number;
      effort: number;
    };
  };
}

export interface CodeStructure {
  functions: FunctionInfo[];
  classes: ClassInfo[];
  modules: ModuleInfo[];
  callGraph: CallGraph;
}

export interface FunctionInfo {
  name: string;
  params: string[];
  returnType?: string;
  location: CodeLocation;
  complexity: number;
}

export interface ClassInfo {
  name: string;
  methods: FunctionInfo[];
  properties: PropertyInfo[];
  location: CodeLocation;
}

export interface PropertyInfo {
  name: string;
  type?: string;
  value?: unknown;
}

export interface ModuleInfo {
  name: string;
  exports: string[];
  imports: string[];
}

export interface CallGraph {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

export interface CallGraphNode {
  id: string;
  name: string;
  type: 'function' | 'method' | 'constructor';
}

export interface CallGraphEdge {
  from: string;
  to: string;
  callCount?: number;
}

export interface TechStack {
  framework?: string;
  bundler?: string;
  uiLibrary?: string;
  stateManagement?: string;
  cryptoLibrary?: string[];
  other: string[];
}

export interface BusinessLogic {
  mainFeatures: string[];
  entities: string[];
  rules: string[];
  dataModel: Record<string, unknown>;
}

export interface DataFlow {
  graph: DataFlowGraph;
  sources: DataSource[];
  sinks: DataSink[];
  taintPaths: TaintPath[];
}

export interface DataFlowGraph {
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
}

export interface DataFlowNode {
  id: string;
  type: 'source' | 'sink' | 'transform';
  name: string;
  location: CodeLocation;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  data: string;
}

export interface DataSource {
  type: 'user_input' | 'storage' | 'network' | 'other';
  location: CodeLocation;
}

export interface DataSink {
  type: 'dom' | 'network' | 'storage' | 'eval' | 'xss' | 'sql-injection' | 'other';
  location: CodeLocation;
}

export interface TaintPath {
  source: DataSource;
  sink: DataSink;
  path: CodeLocation[]; // 污点传播路径
  risk?: 'high' | 'medium' | 'low';
}

export interface SecurityRisk {
  type: 'xss' | 'sql-injection' | 'csrf' | 'sensitive-data' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: CodeLocation;
  description: string;
  recommendation: string;
}

export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
}

// ==================== 加密识别类型 ====================

export interface DetectCryptoOptions {
  code: string;
  testData?: unknown;
}

export interface DetectCryptoResult {
  algorithms: CryptoAlgorithm[];
  libraries: CryptoLibrary[];
  confidence: number;
}

export interface CryptoAlgorithm {
  name: string;
  type: 'symmetric' | 'asymmetric' | 'hash' | 'encoding';
  confidence: number;
  location: CodeLocation;
  parameters?: CryptoParameters;
  usage: string;
}

export interface CryptoParameters {
  key?: string;
  iv?: string;
  mode?: string;
  padding?: string;
}

export interface CryptoLibrary {
  name: string;
  version?: string;
  confidence: number;
}

// ==================== Hook管理类型 ====================
// 核心类型从 modules/hook 导出，这里保留兼容层和通用接口

/**
 * Hook 创建选项（声明式配置）
 * 详细类型定义见 modules/hook/HookManager.ts
 */
export interface HookOptions {
  /** hook 类型（对应注册表中的插件名） */
  type: string;
  /** hook 目标（函数名、API 名等） */
  target?: string;
  /** 行为: log / block / modify / passthrough */
  action?: 'log' | 'block' | 'modify' | 'passthrough';
  /** 自定义代码 */
  customCode?: string;
  /** 条件配置 */
  condition?: HookCondition;
  /** 是否启用性能监控 */
  performance?: boolean;
  /** 类型特定参数 */
  params?: Record<string, unknown>;
  /** 捕获选项 */
  capture?: {
    args?: boolean;
    returnValue?: boolean;
    stack?: boolean | number;
    timing?: boolean;
    thisContext?: boolean;
  };
  /** 生命周期代码 */
  lifecycle?: {
    before?: string;
    after?: string;
    onError?: string;
    onFinally?: string;
    replace?: string;
  };
  /** 存储配置 */
  store?: {
    globalKey?: string;
    maxRecords?: number;
    console?: boolean;
    consoleFormat?: 'full' | 'compact' | 'json';
  };
  /** 描述 */
  description?: string;
}

export interface HookCondition {
  /** JS 条件表达式 */
  expression?: string;
  /** 最大调用次数 */
  maxCalls?: number;
  /** 最小调用间隔(ms) */
  minInterval?: number;
  /** URL 匹配模式 */
  urlPattern?: string;
}

export type HookHandler = (context: HookContext) => void | Promise<void>;

export interface HookContext {
  hookId: string;
  target: string;
  args?: unknown[];
  returnValue?: unknown;
  stack?: string;
  timestamp: number;
  callCount?: number;
  duration?: number;
  [key: string]: unknown;
}

export interface HookResult {
  hookId: string;
  script: string;
  description?: string;
  type?: string;
}

export interface HookRecord {
  hookId: string;
  timestamp: number;
  [key: string]: unknown;
}

// ==================== 浏览器上下文类型 ====================

export interface BrowserContext {
  browser: Browser;
  page: Page;
  url: string;
}

// ==================== 通用结果类型 ====================

export interface Result<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ==================== 会话类型 ====================

export interface Session {
  id: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  data: SessionData;
}

export interface SessionData {
  code?: CollectCodeResult;
  deobfuscated?: DeobfuscateResult;
  analysis?: UnderstandCodeResult;
  crypto?: DetectCryptoResult;
  wasm?: DetectWasmResult;
  hooks?: HookRecord[];
}

// ==================== Wasm 绫诲瀷 ====================

export interface WasmImport {
  module: string;
  name: string;
  kind: 'function' | 'table' | 'memory' | 'global' | 'tag' | 'unknown';
  typeIndex?: number;
  params?: string[];
  results?: string[];
  limits?: {
    min: number;
    max?: number;
    shared?: boolean;
  };
  valueType?: string;
  mutable?: boolean;
}

export interface WasmExport {
  name: string;
  kind: 'function' | 'table' | 'memory' | 'global' | 'tag' | 'unknown';
  index: number;
  params?: string[];
  results?: string[];
  callCount?: number;
}

export interface WasmModuleSummary {
  id: string;
  hash: string;
  size: number;
  sourceUrl?: string;
  contentType?: string;
  loadMethods: string[];
  origin: 'network' | 'runtime' | 'hybrid';
  imports?: WasmImport[];
  exports?: WasmExport[];
  memoryCount: number;
  importCount: number;
  exportCount: number;
  styleHints: string[];
  purposeHints: string[];
  riskTags: string[];
  fingerprints: Array<{
    family: string;
    confidence: number;
    reason: string;
  }>;
  artifactPath?: string;
}

export interface WasmRuntimeCaptureResult {
  id: string;
  type:
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
  timestamp: number;
  moduleId?: string;
  runtimeModuleId?: string;
  loadMethod?: string;
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
  sideEffectHints?: string[];
  memory?: Array<{
    minPages: number;
    maxPages?: number;
    shared?: boolean;
    exportedName?: string;
  }>;
}

export interface DetectWasmOptions {
  url: string;
  timeout?: number;
  waitAfterLoadMs?: number;
  includeRuntimeEvents?: boolean;
  includeImports?: boolean;
  includeExports?: boolean;
  maxModules?: number;
  captureBase64?: boolean;
  taskId?: string;
  taskSlug?: string;
  targetUrl?: string;
  goal?: string;
}

export interface DetectWasmResult {
  modules: WasmModuleSummary[];
  runtimeEvents: WasmRuntimeCaptureResult[];
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

export interface WasmBoundaryChainResult {
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
  steps: Array<{
    type: WasmRuntimeCaptureResult['type'];
    timestamp: number;
    description: string;
    exportName?: string;
    memoryExportName?: string;
    url?: string;
    method?: string;
    stackSummary?: string[];
  }>;
}

export interface WasmDecompileResultSummary {
  moduleId?: string;
  hash?: string;
  size: number;
  wat: string;
  lineCount: number;
  functionCount: number;
  importCount: number;
  exportCount: number;
  functionSummaries: Array<{
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
  }>;
}

// ==================== 环境补全相关类型 ====================

/**
 * 环境变量检测结果
 */
export interface DetectedEnvironmentVariables {
  window: string[];      // window对象的属性
  document: string[];    // document对象的属性
  navigator: string[];   // navigator对象的属性
  location: string[];    // location对象的属性
  screen: string[];      // screen对象的属性
  other: string[];       // 其他全局对象
}

/**
 * 缺失的API信息
 */
export interface MissingAPI {
  name: string;          // API名称
  type: 'function' | 'object' | 'property';
  path: string;          // 完整路径，如 'window.navigator.userAgent'
  suggestion: string;    // 补充建议
}

/**
 * 环境补全代码
 */
export interface EmulationCode {
  nodejs: string;        // Node.js格式的补环境代码
  python: string;        // Python + execjs格式的补环境代码
}

/**
 * 环境补全分析选项
 */
export interface EnvironmentEmulatorOptions {
  code: string;                    // 要分析的代码
  targetRuntime?: 'nodejs' | 'python' | 'both';  // 目标运行时
  autoFetch?: boolean;             // 是否自动从浏览器提取真实值
  browserUrl?: string;             // 浏览器访问的URL（用于提取环境变量）
  browserType?: 'chrome' | 'firefox' | 'safari';  // 浏览器类型
  includeComments?: boolean;       // 生成的代码是否包含注释
  extractDepth?: number;           // 环境变量提取深度（默认3层）
  useAI?: boolean;                 // 是否使用AI分析（默认true）
}

/**
 * 环境补全结果
 */
export interface EnvironmentEmulatorResult {
  // 检测到的环境变量（按类别分组）
  detectedVariables: DetectedEnvironmentVariables;

  // 生成的补环境代码
  emulationCode: EmulationCode;

  // 缺失的API列表（需要手动补充）
  missingAPIs: MissingAPI[];

  // 环境变量清单（JSON格式，可导出）
  variableManifest: Record<string, any>;

  // 补环境建议
  recommendations: string[];

  // 统计信息
  stats: {
    totalVariables: number;
    autoFilledVariables: number;
    manualRequiredVariables: number;
  };

  // AI分析结果（可选）
  aiAnalysis?: any;
}

// ==================== JSVMP反混淆相关类型 ====================

/**
 * 虚拟机类型
 */
export type VMType = 'custom' | 'obfuscator.io' | 'jsfuck' | 'jjencode' | 'unknown';

/**
 * 指令类型
 */
export type InstructionType = 'load' | 'store' | 'arithmetic' | 'control' | 'call' | 'unknown';

/**
 * 复杂度级别
 */
export type ComplexityLevel = 'low' | 'medium' | 'high';

/**
 * VM指令信息
 */
export interface VMInstruction {
  opcode: number | string;       // 操作码
  name: string;                  // 指令名称（推断）
  type: InstructionType;
  description: string;           // 指令描述
  args?: number;                 // 参数数量
}

/**
 * VM特征信息
 */
export interface VMFeatures {
  instructionCount: number;      // 指令数量
  interpreterLocation: string;   // 解释器位置（行号）
  complexity: ComplexityLevel;   // 复杂度
  hasSwitch: boolean;            // 是否有大型switch
  hasInstructionArray: boolean;  // 是否有指令数组
  hasProgramCounter: boolean;    // 是否有程序计数器
}

/**
 * 未还原部分信息
 */
export interface UnresolvedPart {
  location: string;              // 位置（行号或函数名）
  reason: string;                // 未能还原的原因
  suggestion?: string;           // 建议
}

/**
 * JSVMP反混淆选项
 */
export interface JSVMPDeobfuscatorOptions {
  code: string;                  // 要反混淆的代码
  aggressive?: boolean;          // 是否使用激进模式
  extractInstructions?: boolean; // 是否提取指令集
  timeout?: number;              // 超时时间（毫秒）
  maxIterations?: number;        // 最大迭代次数
}

/**
 * JSVMP反混淆结果
 */
export interface JSVMPDeobfuscatorResult {
  // 是否为JSVMP混淆
  isJSVMP: boolean;

  // 虚拟机类型（如果能识别）
  vmType?: VMType;

  // 虚拟机特征
  vmFeatures?: VMFeatures;

  // 提取的指令集（如果extractInstructions=true）
  instructions?: VMInstruction[];

  // 还原后的代码
  deobfuscatedCode: string;

  // 还原置信度 (0-1)
  confidence: number;

  // 还原过程中的警告
  warnings: string[];

  // 未能还原的部分（如果有）
  unresolvedParts?: UnresolvedPart[];

  // 统计信息
  stats?: {
    originalSize: number;
    deobfuscatedSize: number;
    reductionRate: number;
    processingTime: number;
  };
}

// ==================== 调试器增强类型 ====================

/**
 * 作用域变量
 */
export interface ScopeVariable {
  name: string;
  value: any;
  type: string;
  scope: 'global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module';
  writable?: boolean;
  configurable?: boolean;
  enumerable?: boolean;
  objectId?: string; // 用于进一步检查对象属性
}

/**
 * 断点命中事件
 */
export interface BreakpointHitEvent {
  breakpointId: string;
  breakpointInfo?: any; // BreakpointInfo from DebuggerManager
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
    url?: string;
  };
  callFrames: any[]; // CallFrame[]
  timestamp: number;
  variables?: ScopeVariable[]; // 自动获取的顶层作用域变量
  reason: string;
}

/**
 * 断点命中回调函数
 */
export type BreakpointHitCallback = (event: BreakpointHitEvent) => void | Promise<void>;

/**
 * 调试会话数据（用于保存/恢复）
 */
export interface DebuggerSession {
  version: string; // 会话格式版本（当前 1.0）
  timestamp: number; // 创建时间戳
  breakpoints: Array<{
    location: {
      scriptId?: string;
      url?: string;
      lineNumber: number;
      columnNumber?: number;
    };
    condition?: string;
    enabled: boolean;
  }>;
  pauseOnExceptions: 'none' | 'uncaught' | 'all';
  metadata?: {
    url?: string; // 调试的页面 URL
    description?: string; // 会话描述
    tags?: string[]; // 标签
    [key: string]: any; // 其他自定义元数据
  };
}

/**
 * 作用域变量获取选项
 */
export interface GetScopeVariablesOptions {
  callFrameId?: string; // 指定调用帧 ID，不指定则获取顶层帧
  includeObjectProperties?: boolean; // 是否展开对象属性（默认 false）
  maxDepth?: number; // 对象属性展开的最大深度（默认 1）
  skipErrors?: boolean; // 是否跳过错误的作用域（默认 true）
}

/**
 * 作用域变量获取结果
 */
export interface GetScopeVariablesResult {
  success: boolean;
  variables: ScopeVariable[];
  callFrameId: string;
  callFrameInfo?: {
    functionName: string;
    location: string;
  };
  errors?: Array<{
    scope: string;
    error: string;
  }>;
  totalScopes: number;
  successfulScopes: number;
}

// ==================== Reverse Task Artifacts ====================

export interface ReverseTaskStoreOptions {
  rootDir?: string;
}

export interface ReverseTaskOpenInput {
  taskId: string;
  slug: string;
  targetUrl: string;
  goal: string;
}

export interface ReverseTaskDescriptor {
  taskId: string;
  slug: string;
  targetUrl: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReverseTaskEvent {
  stage: string;
  action: string;
  status: string;
  [key: string]: unknown;
}

export interface ReverseTaskHandle {
  taskId: string;
  taskDir: string;
  descriptor: ReverseTaskDescriptor;
  appendTimeline(event: ReverseTaskEvent): Promise<void>;
  appendLog(name: string, value: Record<string, unknown>): Promise<void>;
  writeSnapshot(name: string, value: unknown): Promise<void>;
}

export interface ReverseTaskReadApi {
  getTaskDir(taskId: string): string;
  readSnapshot<T>(taskId: string, name: string): Promise<T | undefined>;
  readLog(name: string, taskId: string): Promise<Record<string, unknown>[]>;
}

// ==================== 全局类型扩展 ====================

declare global {
  interface Window {
    __aiHooks?: Record<string, any[]>;
    __aiHookMetadata?: Record<string, {
      id: string;
      createdAt: number;
      enabled: boolean;
    }>;
  }
}
