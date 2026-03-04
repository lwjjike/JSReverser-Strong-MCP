/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { cliOptions, parseArguments } from '../../../src/cli.js';

interface CliOptionsLike {
  browserUrl: { coerce(value: string | undefined): string | undefined };
  wsEndpoint: { coerce(value: string | undefined): string | undefined };
  wsHeaders: {
    coerce(value: string | undefined): Record<string, string> | undefined;
  };
  viewport: {
    coerce(
      value: string | undefined,
    ): { width: number; height: number } | undefined;
  };
}

interface ParsedArgsLike {
  browserUrl?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  channel?: string;
  headless?: boolean;
  isolated?: boolean;
  categoryNetwork?: boolean;
  viewport?: { width: number; height: number };
  chromeArg?: string[];
  experimentalDevtools?: boolean;
  experimentalIncludeAllPages?: boolean;
}

describe('cli extended coverage', () => {
  it('validates browserUrl/wsEndpoint/wsHeaders coercion', () => {
    const options = cliOptions as unknown as CliOptionsLike;
    const browserUrl = options.browserUrl.coerce;
    assert.strictEqual(browserUrl(undefined), undefined);
    assert.strictEqual(browserUrl('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
    assert.throws(() => browserUrl('not-a-url'), /not valid URL/);

    const wsEndpoint = options.wsEndpoint.coerce;
    assert.strictEqual(wsEndpoint(undefined), undefined);
    assert.strictEqual(
      wsEndpoint('ws://127.0.0.1:9222/devtools/browser/abc'),
      'ws://127.0.0.1:9222/devtools/browser/abc',
    );
    assert.throws(
      () => wsEndpoint('http://127.0.0.1:9222/devtools/browser/abc'),
      /must use ws:\/\/ or wss:\/\//,
    );
    assert.throws(() => wsEndpoint('::bad::'), /not valid URL/);

    const wsHeaders = options.wsHeaders.coerce;
    assert.strictEqual(wsHeaders(undefined), undefined);
    assert.deepStrictEqual(wsHeaders('{"Authorization":"Bearer x"}'), {
      Authorization: 'Bearer x',
    });
    assert.throws(() => wsHeaders('[1,2]'), /Invalid JSON for wsHeaders/);
    assert.throws(() => wsHeaders('{bad json}'), /Invalid JSON for wsHeaders/);
  });

  it('validates viewport coercion', () => {
    const options = cliOptions as unknown as CliOptionsLike;
    const viewport = options.viewport.coerce;
    assert.strictEqual(viewport(undefined), undefined);
    assert.deepStrictEqual(viewport('1280x720'), { width: 1280, height: 720 });
    assert.throws(() => viewport('bad-size'), /Invalid viewport/);
    assert.throws(() => viewport('0x720'), /Invalid viewport/);
  });

  it('parseArguments applies stable channel default when launch target is absent', () => {
    const args = parseArguments('1.2.3', ['node', 'cli.js']) as ParsedArgsLike;
    assert.strictEqual(args.channel, 'stable');
    assert.strictEqual(args.headless, false);
    assert.strictEqual(args.isolated, false);
    assert.strictEqual(args.categoryNetwork, true);
  });

  it('parseArguments keeps explicit launch target without forcing channel', () => {
    const byUrl = parseArguments('1.2.3', [
      'node',
      'cli.js',
      '--browserUrl',
      'http://127.0.0.1:9222',
    ]) as ParsedArgsLike;
    assert.strictEqual(byUrl.browserUrl, 'http://127.0.0.1:9222');
    assert.strictEqual(byUrl.channel, undefined);

    const byWs = parseArguments('1.2.3', [
      'node',
      'cli.js',
      '--wsEndpoint',
      'ws://127.0.0.1:9222/devtools/browser/abc',
      '--wsHeaders',
      '{"Authorization":"Bearer token"}',
    ]) as ParsedArgsLike;
    assert.strictEqual(byWs.wsEndpoint, 'ws://127.0.0.1:9222/devtools/browser/abc');
    assert.deepStrictEqual(byWs.wsHeaders, { Authorization: 'Bearer token' });
    assert.strictEqual(byWs.channel, undefined);
  });

  it('parseArguments supports chrome args, viewport and hidden toggles', () => {
    const parsed = parseArguments('9.9.9', [
      'node',
      'cli.js',
      '--channel',
      'beta',
      '--headless',
      '--isolated',
      '--viewport',
      '1440x900',
      '--chrome-arg=--no-sandbox',
      '--chrome-arg=--disable-gpu',
      '--no-category-network',
      '--experimentalDevtools',
      '--experimentalIncludeAllPages',
    ]) as ParsedArgsLike;

    assert.strictEqual(parsed.channel, 'beta');
    assert.strictEqual(parsed.headless, true);
    assert.strictEqual(parsed.isolated, true);
    assert.deepStrictEqual(parsed.viewport, { width: 1440, height: 900 });
    assert.deepStrictEqual(parsed.chromeArg, ['--no-sandbox', '--disable-gpu']);
    assert.strictEqual(parsed.categoryNetwork, false);
    assert.strictEqual(parsed.experimentalDevtools, true);
    assert.strictEqual(parsed.experimentalIncludeAllPages, true);
  });
});
