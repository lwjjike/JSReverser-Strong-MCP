import wabtFactory from 'wabt';

import type {
  WasmDecompileResult,
  WasmFunctionDisassemblySummary,
} from './WasmTypes.js';

let wabtPromise: ReturnType<typeof wabtFactory> | undefined;

function getWabt() {
  wabtPromise ??= wabtFactory();
  return wabtPromise;
}

interface FunctionBlock {
  name: string;
  index?: number;
  lines: string[];
  signatureLine: string;
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function parseFunctionBlocks(wat: string): FunctionBlock[] {
  const lines = wat.split('\n');
  const blocks: FunctionBlock[] = [];
  let inFunc = false;
  let depth = 0;
  let currentLines: string[] = [];
  let signatureLine = '';
  let currentName = 'func';
  let funcCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inFunc && trimmed.startsWith('(func')) {
      inFunc = true;
      currentLines = [line];
      signatureLine = trimmed;
      const nameMatch = trimmed.match(/^\(func\s+(\$\S+)/);
      currentName = nameMatch?.[1] ?? `func_${funcCounter}`;
      funcCounter += 1;
      depth = countMatches(line, /\(/g) - countMatches(line, /\)/g);
      if (depth <= 0) {
        blocks.push({
          name: currentName,
          index: funcCounter - 1,
          lines: [...currentLines],
          signatureLine,
        });
        inFunc = false;
      }
      continue;
    }

    if (!inFunc) {
      continue;
    }

    currentLines.push(line);
    depth += countMatches(line, /\(/g) - countMatches(line, /\)/g);
    if (depth <= 0) {
      blocks.push({
        name: currentName,
        index: funcCounter - 1,
        lines: [...currentLines],
        signatureLine,
      });
      inFunc = false;
      currentLines = [];
      signatureLine = '';
    }
  }

  return blocks;
}

function summarizeFunction(block: FunctionBlock): WasmFunctionDisassemblySummary {
  const text = block.lines.join('\n');
  const paramCount = countMatches(block.signatureLine, /\(param\b/g);
  const resultCount = countMatches(block.signatureLine, /\(result\b/g);
  const memoryLoadCount = countMatches(text, /\b(?:i32|i64|f32|f64|v128)\.(?:load|load8|load16|load32)/g);
  const memoryStoreCount = countMatches(text, /\b(?:i32|i64|f32|f64|v128)\.(?:store|store8|store16|store32)/g);
  const callCount = countMatches(text, /\bcall\b(?!_indirect)/g);
  const indirectCallCount = countMatches(text, /\bcall_indirect\b/g);
  const localAccessCount = countMatches(text, /\blocal\.(?:get|set|tee)\b/g);
  const instructionCount = block.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('(func') && !line.startsWith(')'))
    .length;

  const suspiciousTags: string[] = [];
  if (memoryLoadCount + memoryStoreCount >= 8) {
    suspiciousTags.push('memory-heavy');
  }
  if (indirectCallCount > 0) {
    suspiciousTags.push('indirect-call');
  }
  if (/(sign|hash|encrypt|decrypt|token|nonce|sha|aes|sm3|sm4|md5)/i.test(block.name)) {
    suspiciousTags.push('crypto-name');
  }
  if (callCount >= 8) {
    suspiciousTags.push('dispatcher-like');
  }
  if (paramCount >= 2 && resultCount <= 1 && memoryStoreCount > 0) {
    suspiciousTags.push('ptr-len-transform');
  }

  return {
    name: block.name,
    index: block.index,
    paramCount,
    resultCount,
    instructionCount,
    callCount,
    indirectCallCount,
    memoryLoadCount,
    memoryStoreCount,
    localAccessCount,
    suspiciousTags,
    preview: block.lines.slice(0, 8).map((line) => line.trim()),
  };
}

export class WasmDecompiler {
  async decompile(
    bytes: Uint8Array,
    options: {
      moduleId?: string;
      hash?: string;
      foldExprs?: boolean;
      inlineExport?: boolean;
    } = {},
  ): Promise<WasmDecompileResult> {
    const wabt = await getWabt();
    const module = wabt.readWasm(bytes, {
      readDebugNames: true,
      check: true,
      mutable_globals: true,
      sat_float_to_int: true,
      sign_extension: true,
      simd: true,
      threads: true,
      function_references: true,
      multi_value: true,
      tail_call: true,
      bulk_memory: true,
      reference_types: true,
      annotations: true,
      code_metadata: true,
      gc: true,
      memory64: true,
      extended_const: true,
      relaxed_simd: true,
    });

    try {
      module.generateNames();
      module.applyNames();
      const wat = module.toText({
        foldExprs: options.foldExprs ?? false,
        inlineExport: options.inlineExport ?? false,
      });
      const functionSummaries = parseFunctionBlocks(wat).map((block) => summarizeFunction(block));

      return {
        moduleId: options.moduleId,
        hash: options.hash,
        size: bytes.byteLength,
        wat,
        lineCount: wat.split('\n').length,
        functionCount: functionSummaries.length,
        importCount: countMatches(wat, /^\s*\(import\b/gm),
        exportCount: countMatches(wat, /^\s*\(export\b/gm),
        functionSummaries: functionSummaries.sort(
          (a, b) =>
            (b.memoryLoadCount + b.memoryStoreCount + b.callCount + b.indirectCallCount) -
            (a.memoryLoadCount + a.memoryStoreCount + a.callCount + a.indirectCallCount),
        ),
      };
    } finally {
      module.destroy();
    }
  }
}
