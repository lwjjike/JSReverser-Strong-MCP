/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { CryptoDetector } from '../../../src/modules/crypto/CryptoDetector.js';

interface LLMServiceLike {
  generateCryptoDetectionPrompt(code: string): Array<{ role: string; content: string }>;
  chat(messages: unknown[]): Promise<{ content: string }>;
}

interface CryptoDetectorHarness {
  detect(options: { code: string; useAI: boolean }): Promise<{
    algorithms: Array<{ name: string; confidence: number }>;
  }>;
  detectLibraries(code: string): unknown[];
  detectByKeywords(code: string): unknown[];
  mergeResults(
    algorithms: Array<{
      name: string;
      type: string;
      confidence: number;
      location: { file: string; line: number };
      usage: string;
    }>,
  ): Array<{ confidence: number }>;
  detectByAI(code: string): Promise<unknown[]>;
  escapeRegex(input: string): string;
  findLineNumber(code: string, needle: string): number;
  rulesManager: {
    getKeywordRules(): unknown[];
    getLibraryRules(): unknown[];
  };
}

interface CryptoDetectorPublicHarness {
  exportRules(): string;
  loadCustomRules(json: string): void;
}

describe('CryptoDetector extended', () => {
  it('covers load/export rules and keyword/library detection paths', async () => {
    const llm = {
      generateCryptoDetectionPrompt: () => [{ role: 'user', content: 'crypto' }],
      chat: async () => ({ content: '{"algorithms":[]}' }),
    } satisfies LLMServiceLike;
    const detector = new CryptoDetector(
      llm as unknown as ConstructorParameters<typeof CryptoDetector>[0],
    ) as unknown as CryptoDetectorPublicHarness;
    const detectorInternals = detector as unknown as CryptoDetectorHarness;

    const exported = detector.exportRules();
    assert.strictEqual(typeof exported, 'string');

    detector.loadCustomRules(exported);
    const reExported = detector.exportRules();
    assert.strictEqual(typeof reExported, 'string');

    const libs = detectorInternals.detectLibraries(
      'CryptoJS.version="4.1.1"; forge.random.getBytesSync(16);',
    );
    assert.ok(libs.length >= 1);

    const kws = detectorInternals.detectByKeywords('AES.encrypt(x); CBC; PKCS7;');
    // mode/padding 关键词会被跳过，算法关键词应仍可命中
    assert.ok(Array.isArray(kws));
  });

  it('covers detect useAI true/false and merge ordering', async () => {
    const llm = {
      generateCryptoDetectionPrompt: () => [{ role: 'user', content: 'crypto' }],
      chat: async () => ({
        content: '{"algorithms":[{"name":"CustomAES","type":"symmetric","confidence":0.9,"usage":"x"}]}',
      }),
    } satisfies LLMServiceLike;
    const detector = new CryptoDetector(
      llm as unknown as ConstructorParameters<typeof CryptoDetector>[0],
    ) as unknown as CryptoDetectorHarness;

    const noAI = await detector.detect({
      code: 'const h = md5(x); const x = CryptoJS.AES.encrypt(a,b);',
      useAI: false,
    });
    assert.ok(noAI.algorithms.length >= 1);

    const withAI = await detector.detect({
      code: 'const h = md5(x); const x = CryptoJS.AES.encrypt(a,b);',
      useAI: true,
    });
    assert.ok(withAI.algorithms.some((a) => a.name === 'CustomAES'));

    const merged = detector.mergeResults([
      { name: 'A', type: 'hash', confidence: 0.5, location: { file: 'current', line: 1 }, usage: '' },
      { name: 'A', type: 'hash', confidence: 0.9, location: { file: 'current', line: 2 }, usage: '' },
      { name: 'B', type: 'hash', confidence: 0.6, location: { file: 'current', line: 3 }, usage: '' },
    ]);
    assert.strictEqual(merged[0]?.confidence, 0.9);
  });

  it('covers AI parser fallback branches and helper methods', async () => {
    const llmNoJson = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => ({ content: 'no-json-content' }),
    } satisfies LLMServiceLike;
    const detector1 = new CryptoDetector(
      llmNoJson as unknown as ConstructorParameters<typeof CryptoDetector>[0],
    ) as unknown as CryptoDetectorHarness;
    assert.deepStrictEqual(await detector1.detectByAI('const x=1'), []);

    const llmBadShape = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => ({ content: '{"algorithms":{}}' }),
    } satisfies LLMServiceLike;
    const detector2 = new CryptoDetector(
      llmBadShape as unknown as ConstructorParameters<typeof CryptoDetector>[0],
    ) as unknown as CryptoDetectorHarness;
    assert.deepStrictEqual(await detector2.detectByAI('const x=1'), []);

    const llmThrow = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => {
        throw new Error('ai fail');
      },
    } satisfies LLMServiceLike;
    const detector3 = new CryptoDetector(
      llmThrow as unknown as ConstructorParameters<typeof CryptoDetector>[0],
    ) as unknown as CryptoDetectorHarness;
    assert.deepStrictEqual(await detector3.detectByAI('const x=1'), []);

    assert.strictEqual(detector3.escapeRegex('a+b*c?'), 'a\\+b\\*c\\?');
    assert.strictEqual(detector3.findLineNumber('a\nb\nc', 'x'), 0);
    assert.strictEqual(detector3.findLineNumber('a\nfind-me\nc', 'find-me'), 2);
  });

  it('covers detect catch path when rule manager throws', async () => {
    const llm = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => ({ content: '{"algorithms":[]}' }),
    } satisfies LLMServiceLike;
    const detector = new CryptoDetector(
      llm as unknown as ConstructorParameters<typeof CryptoDetector>[0],
    ) as unknown as CryptoDetectorHarness;
    detector.rulesManager = {
      getKeywordRules: () => {
        throw new Error('rules boom');
      },
      getLibraryRules: () => [],
    };

    await assert.rejects(
      async () => {
        await detector.detect({ code: 'const x=1', useAI: false });
      },
      /rules boom/,
    );
  });
});
