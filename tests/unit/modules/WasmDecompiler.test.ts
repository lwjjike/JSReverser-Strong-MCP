/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {WasmDecompiler} from '../../../src/modules/wasm/WasmDecompiler.js';

const SIMPLE_WASM = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x73, 0x69, 0x67, 0x6e, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

describe('WasmDecompiler', () => {
  it('emits WAT and function summaries using wabt', async () => {
    const decompiler = new WasmDecompiler();
    const result = await decompiler.decompile(SIMPLE_WASM, {
      moduleId: 'wasm_test',
      hash: 'hash',
    });

    assert.strictEqual(result.moduleId, 'wasm_test');
    assert.ok(result.wat.includes('(module'));
    assert.ok(result.wat.includes('(func'));
    assert.ok(result.wat.includes('export "sign"'));
    assert.strictEqual(result.functionCount, 1);
    assert.strictEqual(result.functionSummaries[0]?.name.includes('sign'), true);
  });
});
