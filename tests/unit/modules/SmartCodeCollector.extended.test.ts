/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { SmartCodeCollector } from '../../../src/modules/collector/SmartCodeCollector.js';

interface CodeFileLike {
  url: string;
  content: string;
  size: number;
  type: 'external' | 'inline';
  metadata: Record<string, unknown>;
}

interface SmartCodeCollectorHarness {
  smartCollect(
    page: unknown,
    files: CodeFileLike[],
    options: {
      mode: 'summary' | 'full';
      maxTotalSize?: number;
    },
  ): Promise<Array<Record<string, unknown>>>;
  collectByPriority(
    files: CodeFileLike[],
    options: {
      mode: 'priority';
      maxTotalSize: number;
      maxFileSize: number;
      priorities: string[];
    },
  ): CodeFileLike[];
  collectIncremental(
    files: CodeFileLike[],
    options: {
      mode: 'incremental';
      includePatterns: string[];
      excludePatterns: string[];
      maxTotalSize: number;
      maxFileSize: number;
    },
  ): CodeFileLike[];
  detectEncryption(code: string): boolean;
  detectAPI(code: string): boolean;
  detectObfuscation(code: string): boolean;
  extractFunctions(code: string): string[];
  extractImports(code: string): string[];
}

describe('SmartCodeCollector extended', () => {
  const files: CodeFileLike[] = [
    {
      url: 'https://site.com/main-crypto.js',
      content: 'function enc(){return CryptoJS.AES.encrypt("a","b")} import x from "dep";',
      size: 200,
      type: 'external',
      metadata: {},
    },
    {
      url: 'https://site.com/vendor-lib.js',
      content: 'eval("1"); const req = require("axios")',
      size: 600_000,
      type: 'external',
      metadata: {},
    },
    {
      url: 'https://site.com/inline-api',
      content: 'const f = () => fetch("/api");',
      size: 100,
      type: 'inline',
      metadata: {},
    },
  ];

  it('routes by mode and returns summary details', async () => {
    const collector = new SmartCodeCollector() as unknown as SmartCodeCollectorHarness;
    const summary = await collector.smartCollect(null, files, { mode: 'summary' });
    assert.strictEqual(Array.isArray(summary), true);
    assert.strictEqual(summary[0]?.hasEncryption, true);
    assert.strictEqual(
      Array.isArray(summary[0]?.imports) && summary[0].imports.includes('dep'),
      true,
    );

    const full = await collector.smartCollect(null, files, {
      mode: 'full',
      maxTotalSize: 10_000,
    });
    assert.strictEqual(full.length >= 1, true);
  });

  it('collects by priority and applies truncation/size limits', () => {
    const collector = new SmartCodeCollector() as unknown as SmartCodeCollectorHarness;
    const picked = collector.collectByPriority(files, {
      mode: 'priority',
      maxTotalSize: 250,
      maxFileSize: 120,
      priorities: ['main', 'crypto'],
    });

    assert.strictEqual(picked.length >= 1, true);
    assert.strictEqual(picked[0]?.metadata?.priorityScore !== undefined, true);
    assert.strictEqual((picked[0]?.size ?? 0) <= 120, true);
  });

  it('supports incremental filtering, default include-all and regex patterns', () => {
    const collector = new SmartCodeCollector() as unknown as SmartCodeCollectorHarness;

    const incremental = collector.collectIncremental(files, {
      mode: 'incremental',
      includePatterns: ['main|inline'],
      excludePatterns: ['vendor'],
      maxTotalSize: 10_000,
      maxFileSize: 1_000,
    });
    assert.strictEqual(incremental.length, 2);

    const includeAll = collector.collectIncremental(files, {
      mode: 'incremental',
      includePatterns: [],
      excludePatterns: [],
      maxTotalSize: 10_000,
      maxFileSize: 1_000,
    });
    assert.strictEqual(includeAll.length >= 2, true);
  });

  it('covers detection and extraction helper branches', () => {
    const collector = new SmartCodeCollector() as unknown as SmartCodeCollectorHarness;

    assert.strictEqual(collector.detectEncryption('const x = md5("a")'), true);
    assert.strictEqual(collector.detectEncryption('const x = 1'), false);
    assert.strictEqual(collector.detectAPI('axios.get("/a")'), true);
    assert.strictEqual(collector.detectAPI('const x = 1'), false);
    assert.strictEqual(collector.detectObfuscation('\\x61\\x62\\x63'), true);
    assert.strictEqual(collector.detectObfuscation('line1\nline2'), false);

    const fnNames = collector.extractFunctions(
      'function run(){} const h=function(){}; obj={call:function(){}}; function run(){}',
    );
    assert.strictEqual(fnNames.includes('run'), true);
    assert.strictEqual(fnNames.includes('h'), true);

    const imports = collector.extractImports(
      'import x from "a"; const y=require("b"); import z from "a";',
    );
    assert.deepStrictEqual(imports.sort(), ['a', 'b']);
  });
});
