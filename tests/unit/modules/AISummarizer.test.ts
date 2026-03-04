/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { AISummarizer } from '../../../src/modules/analyzer/AISummarizer.js';
import type { CodeFile } from '../../../src/types/index.js';

interface LLMServiceLike {
  chat(messages: unknown[]): Promise<{ content: string } | string>;
}

describe('AISummarizer', () => {
  const file: CodeFile = {
    url: 'https://example.com/app.js',
    type: 'external' as const,
    size: 120,
    content: 'function run(){ return fetch("/api") }\nconst pwd="secret123456";',
  };

  it('summarizes file from AI JSON response', async () => {
    const llm = {
      chat: async () => ({
        content: JSON.stringify({
          summary: 'desc',
          purpose: 'purpose',
          keyFunctions: ['run'],
          dependencies: ['axios'],
          hasEncryption: true,
          hasAPI: true,
          hasObfuscation: false,
          complexity: 'medium',
        }),
      }),
    } satisfies LLMServiceLike;
    const s = new AISummarizer(llm as unknown as ConstructorParameters<typeof AISummarizer>[0]);
    const out = await s.summarizeFile(file);
    assert.strictEqual(out.summary, 'desc');
    assert.strictEqual(out.purpose, 'purpose');
    assert.strictEqual(out.hasAPI, true);
  });

  it('falls back to basic analysis on AI failure', async () => {
    const llm = {
      chat: async () => {
        throw new Error('ai down');
      },
    } satisfies LLMServiceLike;
    const s = new AISummarizer(llm as unknown as ConstructorParameters<typeof AISummarizer>[0]);
    const out = await s.summarizeFile(file);
    assert.strictEqual(out.summary.includes('Basic analysis'), true);
    assert.ok(Array.isArray(out.keyFunctions));
  });

  it('summarizes batches and project metadata', async () => {
    const llm = {
      chat: async () => ({
        content: JSON.stringify({
          mainPurpose: 'project',
          architecture: 'SPA',
          technologies: ['React'],
          securityConcerns: ['xss'],
          recommendations: ['sanitize'],
        }),
      }),
    } satisfies LLMServiceLike;
    const s = new AISummarizer(llm as unknown as ConstructorParameters<typeof AISummarizer>[0]);
    const batch = await s.summarizeBatch([file, file], 1);
    assert.strictEqual(batch.length, 2);

    const project = await s.summarizeProject([file, file]);
    assert.strictEqual(project.totalFiles, 2);
    assert.strictEqual(project.architecture, 'SPA');
  });

  it('uses safe fallback when project JSON is invalid', async () => {
    const llm = {
      chat: async () => ({ content: 'not-json' }),
    } satisfies LLMServiceLike;
    const s = new AISummarizer(llm as unknown as ConstructorParameters<typeof AISummarizer>[0]);
    const project = await s.summarizeProject([file]);
    assert.strictEqual(project.mainPurpose, 'Analysis failed');
  });
});
