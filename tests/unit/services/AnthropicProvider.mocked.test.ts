/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import { AnthropicProvider } from '../../../src/services/AnthropicProvider.js';

interface AnthropicClientLike {
  messages: {
    create(input: unknown): Promise<{
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

interface ChatResultLike {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface PayloadLike {
  system?: string;
  messages?: Array<Record<string, unknown>>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

interface ImageSourceLike {
  media_type: string;
}

interface AnalyzeImageCallLike {
  messages: Array<{
    content: Array<{
      source: ImageSourceLike;
    }>;
  }>;
}

interface AnthropicProviderHarness {
  client: AnthropicClientLike;
  getMediaType(extension: string): string;
  chat(
    messages: Array<{ role: string; content: string }>,
    options?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<ChatResultLike>;
  analyzeImage(imageInput: string, prompt: string, isFilePath?: boolean): Promise<string>;
}

describe('AnthropicProvider (mocked)', () => {
  it('throws when api key is missing', () => {
    assert.throws(
      () => new AnthropicProvider({ apiKey: '' }),
      /Anthropic API key is required/,
    );
  });

  it('maps response content and usage for chat', async () => {
    const payloads: PayloadLike[] = [];
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test-key',
    }) as unknown as AnthropicProviderHarness;
    provider.client = {
      messages: {
        create: async (input: unknown) => {
          payloads.push(input as PayloadLike);
          return {
            content: [
              { type: 'text', text: 'hello ' },
              { type: 'text', text: 'world' },
            ],
            usage: { input_tokens: 5, output_tokens: 7 },
          };
        },
      },
    };

    const result = await provider.chat([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);

    assert.strictEqual(result.content, 'hello world');
    assert.deepStrictEqual(result.usage, {
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12,
    });
    const chatPayload = payloads[0];
    if (!chatPayload) {
      throw new Error('Expected payload to be captured');
    }
    assert.strictEqual(chatPayload.system, 'rules');
    assert.deepStrictEqual(chatPayload.messages, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('throws when invalid data URL is passed to analyzeImage', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-key' });
    await assert.rejects(
      async () => provider.analyzeImage('data:invalid', 'prompt', false),
      /Invalid data URL format/,
    );
  });

  it('supports base64/data-url/file inputs in analyzeImage', async () => {
    const calls: AnalyzeImageCallLike[] = [];
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test-key',
    }) as unknown as AnthropicProviderHarness;
    provider.client = {
      messages: {
        create: async (input: unknown) => {
          calls.push(input as AnalyzeImageCallLike);
          return {
            content: [{ type: 'text', text: 'vision ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };

    const out1 = await provider.analyzeImage('dGVzdA==', 'a', false);
    const out2 = await provider.analyzeImage('data:image/gif;base64,abcd', 'b', false);

    const tempPath = join(tmpdir(), `anthropic-provider-test-${Date.now()}.jpg`);
    writeFileSync(tempPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
    const out3 = await provider.analyzeImage(tempPath, 'c', true);
    rmSync(tempPath, { force: true });

    assert.strictEqual(out1, 'vision ok');
    assert.strictEqual(out2, 'vision ok');
    assert.strictEqual(out3, 'vision ok');

    const source0 = calls[0].messages[0].content[0].source;
    const source1 = calls[1].messages[0].content[0].source;
    const source2 = calls[2].messages[0].content[0].source;
    assert.strictEqual(source0.media_type, 'image/png');
    assert.strictEqual(source1.media_type, 'image/gif');
    assert.strictEqual(source2.media_type, 'image/jpeg');
  });

  it('falls back to png media type for unknown extensions', () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test-key',
    }) as unknown as AnthropicProviderHarness;
    assert.strictEqual(provider.getMediaType('webp'), 'image/webp');
    assert.strictEqual(provider.getMediaType('unknown'), 'image/png');
  });

  it('covers Anthropic APIError and unknown error formatting paths', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test-key',
    }) as unknown as AnthropicProviderHarness;

    const apiError = Object.assign(new Error('api down'), { status: 503 });
    Object.setPrototypeOf(apiError, Anthropic.APIError.prototype);

    provider.client = {
      messages: {
        create: async () => {
          throw apiError;
        },
      },
    };
    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hi' }]),
      (err: unknown) =>
        typeof err === 'object' && err !== null && 'status' in err &&
        (err as { status?: number }).status === 503,
    );

    provider.client = {
      messages: {
        create: async () => {
          throw 12345;
        },
      },
    };
    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hi' }]),
      /Unknown error: 12345/,
    );
  });

  it('covers chat options mapping and file path without extension branch', async () => {
    const payloads: PayloadLike[] = [];
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test-key',
    }) as unknown as AnthropicProviderHarness;
    provider.client = {
      messages: {
        create: async (input: unknown) => {
          payloads.push(input as PayloadLike);
          return {
            content: [{ type: 'text', text: '' }],
            usage: { input_tokens: 2, output_tokens: 3 },
          };
        },
      },
    };

    await provider.chat([{ role: 'user', content: 'x' }], {
      model: 'claude-test',
      temperature: 0.1,
      maxTokens: 12,
    });
    const optionsPayload = payloads[0];
    if (!optionsPayload) {
      throw new Error('Expected payload to be captured');
    }
    assert.strictEqual(optionsPayload.model, 'claude-test');
    assert.strictEqual(optionsPayload.temperature, 0.1);
    assert.strictEqual(optionsPayload.max_tokens, 12);

    const tempPath = join(tmpdir(), `anthropic-provider-test-${Date.now()}`);
    writeFileSync(tempPath, Buffer.from([0x01]));
    const result = await provider.analyzeImage(tempPath, 'prompt', true);
    rmSync(tempPath, { force: true });
    assert.strictEqual(result, '');
  });
});
