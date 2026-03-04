/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { formatConsoleEventVerbose } from '../../../src/formatters/consoleFormatter.js';
import { getFormattedResponseBody } from '../../../src/formatters/networkFormatter.js';

describe('console and network formatters', () => {
  it('renders error stack and cause chain for verbose console output', () => {
    const output = formatConsoleEventVerbose({
      consoleMessageStableId: 7,
      type: 'error',
      message: 'Request failed',
      sourceMapHints: {
        'app.js': 'https://cdn.example.com/app.js.map',
        'vendor.js': 'https://cdn.example.com/vendor.js.map',
      },
      args: [
        JSON.stringify({
          message: 'outer boom',
          stack: 'Error: outer boom\n    at outer (app.js:10:2)',
          cause: {
            message: 'inner boom',
            stack: 'Error: inner boom\n    at inner (vendor.js:2:1)',
          },
        }),
      ],
    });

    assert.ok(output.includes('### Arguments'));
    assert.ok(output.includes('outer boom'));
    assert.ok(output.includes('app.js:10:2'));
    assert.ok(output.includes('SourceMap: https://cdn.example.com/app.js.map'));
    assert.ok(output.includes('inner boom'));
    assert.ok(output.includes('vendor.js:2:1'));
    assert.ok(output.includes('SourceMap: https://cdn.example.com/vendor.js.map'));
    assert.ok(output.includes('Cause'));
  });

  it('degrades response body reads on timeout', async () => {
    const formatter = getFormattedResponseBody as unknown as (
      response: Parameters<typeof getFormattedResponseBody>[0],
      sizeLimit: number,
      timeoutMs: number,
    ) => Promise<string | undefined>;
    const body = await Promise.race([
      formatter({
        buffer: async () => await new Promise<Buffer>(() => undefined),
      } as Parameters<typeof getFormattedResponseBody>[0], 1000, 10),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('<test-timeout>'), 50);
      }),
    ]);

    assert.strictEqual(body, '<timed out while reading response body>');
  });
});
