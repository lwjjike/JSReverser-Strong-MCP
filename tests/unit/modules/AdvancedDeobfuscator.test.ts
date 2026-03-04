/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { AdvancedDeobfuscator } from '../../../src/modules/deobfuscator/AdvancedDeobfuscator.js';
import type {
  AdvancedDeobfuscateOptions,
  AdvancedDeobfuscateResult,
} from '../../../src/modules/deobfuscator/AdvancedDeobfuscator.js';

interface LLMServiceLike {
  chat(messages: unknown[]): Promise<{ content: string } | string>;
}

interface VmDetectionLike {
  detected: boolean;
  type: string;
  instructionCount: number;
}

interface VmStructureLike {
  hasInterpreter?: boolean;
  hasStack?: boolean;
  hasRegisters?: boolean;
  interpreterFunction?: string;
  instructionArray?: string;
}

interface VmResultLike {
  success: boolean;
  code: string;
}

interface AdvancedDeobfuscatorTestHarness {
  detectInvisibleUnicode(code: string): boolean;
  decodeInvisibleUnicode(code: string): string;
  detectStringEncoding(code: string): boolean;
  detectVMProtection(code: string): VmDetectionLike;
  analyzeVMStructure(code: string): VmStructureLike;
  simplifyVMCode(code: string, vmComponents: VmStructureLike): string;
  detectControlFlowFlattening(code: string): boolean;
  removeDeadCode(code: string): string;
  removeOpaquePredicates(code: string): string;
  unflattenControlFlow(code: string): Promise<string>;
  extractCodeFromLLMResponse(response: string): string;
  isValidJavaScript(code: string): boolean;
  applyASTOptimizations(code: string): string;
  calculateConfidence(
    techniques: string[],
    warnings: string[],
    code: string,
  ): number;
  llmCleanup(code: string, techniques: string[]): Promise<string | null>;
  deobfuscate(options: AdvancedDeobfuscateOptions): Promise<AdvancedDeobfuscateResult>;
  deobfuscateVM(
    code: string,
    vmInfo: Pick<VmDetectionLike, 'type' | 'instructionCount'>,
  ): Promise<VmResultLike>;
  derotateStringArray(code: string): string;
  normalizeCode(code: string): string;
  estimateCodeComplexity(code: string): number;
}

describe('AdvancedDeobfuscator', () => {
  it('covers invisible unicode/string detection and decode helpers', () => {
    const d = new AdvancedDeobfuscator() as unknown as AdvancedDeobfuscatorTestHarness;
    const zw = '\u200b\u200c\u200b\u200b\u200b\u200b\u200b\u200c'; // 01000001 => 'A'

    assert.strictEqual(d.detectInvisibleUnicode(`x${zw}y`), true);
    assert.strictEqual(d.detectInvisibleUnicode('normal text'), false);

    const decoded = d.decodeInvisibleUnicode(`const s="${zw}"`);
    assert.ok(decoded.includes('A'));

    assert.strictEqual(d.detectStringEncoding('const x="\\x61\\u0062";'), true);
    assert.strictEqual(d.detectStringEncoding('const x="abc";'), false);
  });

  it('covers VM/control-flow/dead-code/opaque detection and transforms', async () => {
    const d = new AdvancedDeobfuscator() as unknown as AdvancedDeobfuscatorTestHarness;
    const vmCode = `
      while(true){ switch(op){ case 0: stack.push(1); break; case 1: stack.pop(); break; } }
      var code=[1,2,3,4,5,6,7,8,9,10,11,12];
    `;
    const vm = d.detectVMProtection(vmCode);
    assert.strictEqual(vm.detected, true);
    assert.ok(vm.instructionCount >= 2);

    const vmStructure = d.analyzeVMStructure(
      'while(true){switch(x){case 0x1:break;}} stack.push(1); r1=2;',
    );
    assert.strictEqual(vmStructure.hasInterpreter, true);
    assert.strictEqual(vmStructure.hasStack, true);
    assert.strictEqual(vmStructure.hasRegisters, true);

    const simplifiedVm = d.simplifyVMCode(
      'function interp(){return 1;} var inst=[1,2,3]; interp();',
      { interpreterFunction: 'interp', instructionArray: 'inst' },
    );
    assert.ok(simplifiedVm.includes('VM interpreter removed'));

    assert.strictEqual(
      d.detectControlFlowFlattening('while(!![]){switch(x){case 1:break;}}'),
      true,
    );

    const deadOut = d.removeDeadCode('function f(){ if(false){a()} else {b()} if(true){c()} return 1; d(); }');
    assert.ok(!deadOut.includes('if (false)'));
    assert.ok(!deadOut.includes('d();'));

    const opaqueOut = d.removeOpaquePredicates('if(5>3){a()} if(1===2){b()}');
    assert.ok(opaqueOut.includes('a()'));
    assert.ok(!opaqueOut.includes('if (1 === 2)'));

    const unflattened = await d.unflattenControlFlow('const x=1;');
    assert.strictEqual(unflattened, 'const x=1;');
  });

  it('covers code extraction/validation/ast optimization/confidence', () => {
    const d = new AdvancedDeobfuscator() as unknown as AdvancedDeobfuscatorTestHarness;
    const extracted = d.extractCodeFromLLMResponse('```javascript\nconst x = 1;\n```');
    assert.strictEqual(extracted, 'const x = 1;');

    assert.strictEqual(d.isValidJavaScript('const a = 1;'), true);
    assert.strictEqual(d.isValidJavaScript('const a = ;'), false);

    const optimized = d.applyASTOptimizations('const a=(1+2); const b=true&&x; false||y;');
    assert.ok(optimized.includes('3'));
    assert.ok(optimized.includes('x'));

    const c1 = d.calculateConfidence(['vm-protection', 'ast-optimized'], ['warn'], 'const a=1;');
    const c2 = d.calculateConfidence([], ['w1', 'w2', 'w3'], 'function a(){if(x){while(y){}}}');
    assert.ok(c1 >= 0.1 && c1 <= 0.95);
    assert.ok(c2 >= 0.1 && c2 <= 0.95);
  });

  it('covers llm cleanup path and full deobfuscate path', async () => {
    const llm = {
      chat: async () => ({ content: '```javascript\nconst cleaned = 1;\n```' }),
    } satisfies LLMServiceLike;
    const d = new AdvancedDeobfuscator(
      llm as unknown as ConstructorParameters<typeof AdvancedDeobfuscator>[0],
    ) as unknown as AdvancedDeobfuscatorTestHarness;

    const cleaned = await d.llmCleanup('const a=1;', ['string-encoding']);
    assert.strictEqual(cleaned, 'const cleaned = 1;');

    const result = await d.deobfuscate({
      code: '\\x61\\u0062;if(false){x()}',
      aggressiveVM: false,
      useASTOptimization: true,
    });
    assert.strictEqual(typeof result.code, 'string');
    assert.ok(Array.isArray(result.detectedTechniques));
    assert.ok(result.confidence > 0);
  });

  it('covers deobfuscateVM success/fallback branches', async () => {
    const llmOk = {
      chat: async () => ({ content: '```javascript\nconst vmOut = 1;\n```' }),
    } satisfies LLMServiceLike;
    const d1 = new AdvancedDeobfuscator(
      llmOk as unknown as ConstructorParameters<typeof AdvancedDeobfuscator>[0],
    ) as unknown as AdvancedDeobfuscatorTestHarness;
    const vmOk = await d1.deobfuscateVM('while(true){switch(x){case 0x1:break;}}', {
      type: 'custom-vm',
      instructionCount: 1,
    });
    assert.strictEqual(vmOk.success, true);
    assert.ok(vmOk.code.includes('vmOut'));

    const llmBad = {
      chat: async () => ({ content: 'not js {{' }),
    } satisfies LLMServiceLike;
    const d2 = new AdvancedDeobfuscator(
      llmBad as unknown as ConstructorParameters<typeof AdvancedDeobfuscator>[0],
    ) as unknown as AdvancedDeobfuscatorTestHarness;
    const vmBad = await d2.deobfuscateVM('var x=1;', { type: 'custom-vm', instructionCount: 0 });
    assert.strictEqual(typeof vmBad.code, 'string');
  });

  it('covers control-flow llm branch, derotate and normalization helpers', async () => {
    const llm = {
      chat: async () => ({ content: '```js\nconst cleanFlow = 1;\n```' }),
    } satisfies LLMServiceLike;
    const d = new AdvancedDeobfuscator(
      llm as unknown as ConstructorParameters<typeof AdvancedDeobfuscator>[0],
    ) as unknown as AdvancedDeobfuscatorTestHarness;

    const unflattened = await d.unflattenControlFlow(
      'while(true){switch(i){case 0:i=1;break;case 1:break;}}',
    );
    assert.ok(unflattened.includes('cleanFlow') || unflattened.includes('while'));

    const rotated = `
      (function(_0xabc,_0xdef){
        while(true){
          try { break; } catch(e){ _0xabc.push(_0xabc.shift()); }
        }
      })(['a','b'], 0x1);
      console.log("x");
    `;
    const derotated = d.derotateStringArray(rotated);
    assert.ok(derotated.includes('console.log'));

    const normalized = d.normalizeCode('/*a*/ const x = 1; // c\\n\\n const y = 2;');
    assert.ok(normalized.includes('const'));

    const complexity = d.estimateCodeComplexity('if(a){for(let i=0;i<2;i++){while(b){break;}}}');
    assert.ok(complexity > 0);
  });
});
