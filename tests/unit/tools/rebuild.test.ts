/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {ReverseTaskStore} from '../../../src/reverse/ReverseTaskStore.js';
import {diffEnvRequirements, exportRebuildBundle} from '../../../src/tools/rebuild.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';

interface ResponseShape {
  lines: string[];
  appendResponseLine(value: string): void;
}

function makeResponse(): ResponseShape {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (value: string) => {
      lines.push(value);
    },
  };
}

function extractFirstJsonBlock(lines: string[]): Record<string, unknown> {
  const start = lines.indexOf('```json');
  const end = lines.indexOf('```', start + 1);
  return JSON.parse(lines.slice(start + 1, end).join('\n')) as Record<string, unknown>;
}

describe('rebuild bridge tools', () => {
  it('exports a local rebuild bundle and prioritizes env patches from runtime errors', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'js-reverse-rebuild-'));
    const runtime = getJSHookRuntime();
    const originalStore = runtime.reverseTaskStore;
    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const exportResponse = makeResponse();
      await exportRebuildBundle.handler({
        params: {
          taskId: 'task-001',
          taskSlug: 'demo',
          targetUrl: 'https://example.com',
          goal: 'rebuild signature',
          entryCode: 'import "./env.js";\nconsole.log(signToken("a", "b"));',
          envCode: 'globalThis.window = globalThis;',
          polyfillsCode: 'globalThis.atob = (v) => v;',
          capture: {
            cookies: [{name: 'sid', value: '1'}],
            requests: [{url: 'https://example.com/api/sign', method: 'POST'}],
          },
          notes: [
            'target request is /api/sign',
            'cookie sid participates in request chain',
          ],
        },
      } as Parameters<typeof exportRebuildBundle.handler>[0], exportResponse as unknown as Parameters<typeof exportRebuildBundle.handler>[1], {} as Parameters<typeof exportRebuildBundle.handler>[2]);

      await stat(path.join(rootDir, 'task-001', 'env', 'entry.js'));
      await stat(path.join(rootDir, 'task-001', 'env', 'env.js'));
      await stat(path.join(rootDir, 'task-001', 'env', 'polyfills.js'));
      await stat(path.join(rootDir, 'task-001', 'env', 'capture.json'));
      await stat(path.join(rootDir, 'task-001', 'report.md'));

      const report = await readFile(path.join(rootDir, 'task-001', 'report.md'), 'utf8');
      assert.ok(report.includes('/api/sign'));
      assert.ok(report.includes('cookie sid'));

      const diffResponse = makeResponse();
      await diffEnvRequirements.handler({
        params: {
          runtimeError: "ReferenceError: window is not defined\nReferenceError: localStorage is not defined\nTypeError: Cannot read properties of undefined (reading 'subtle')",
          observedCapabilities: ['window', 'document', 'navigator', 'localStorage', 'crypto'],
        },
      } as Parameters<typeof diffEnvRequirements.handler>[0], diffResponse as unknown as Parameters<typeof diffEnvRequirements.handler>[1], {} as Parameters<typeof diffEnvRequirements.handler>[2]);

      const diffJson = extractFirstJsonBlock(diffResponse.lines);
      assert.ok(Array.isArray(diffJson.missingCapabilities));
      assert.ok(Array.isArray(diffJson.nextPatches));
      assert.strictEqual((diffJson.nextPatches as Array<Record<string, unknown>>)[0].capability, 'window');
    } finally {
      runtime.reverseTaskStore = originalStore;
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  it('auto-generates a rebuild bundle from observed page evidence and task logs', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'js-reverse-rebuild-auto-'));
    const runtime = getJSHookRuntime();
    const originalStore = runtime.reverseTaskStore;
    const originals = {
      getTopPriorityFiles: runtime.collector.getTopPriorityFiles,
      getCookies: runtime.pageController.getCookies,
      getLocalStorage: runtime.pageController.getLocalStorage,
      getSessionStorage: runtime.pageController.getSessionStorage,
      getPage: runtime.pageController.getPage,
    };
    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const task = await runtime.reverseTaskStore.openTask({
        taskId: 'task-002',
        slug: 'auto-demo',
        targetUrl: 'https://example.com/product',
        goal: 'rebuild signature',
      });
      await task.appendLog('runtime-evidence', {
        source: 'hook',
        requestUrl: 'https://example.com/api/sign',
        functionName: 'signPayload',
        bodyPreview: '{"token":"abc","sign":"xyz"}',
      });
      await task.writeSnapshot('cookies.json', {
        cookies: [{name: 'sid', value: 'cookie-1'}],
      });

      runtime.collector.getTopPriorityFiles = () => ({
        files: [{
          url: 'https://example.com/static/sign.js',
          content: 'function signPayload(token, nonce) { return token + nonce; }',
          size: 58,
          type: 'external',
        }],
        totalSize: 58,
        totalFiles: 1,
      });
      runtime.pageController.getCookies = async () => [{name: 'sid', value: 'cookie-1'}];
      runtime.pageController.getLocalStorage = async () => ({token: 'abc'});
      runtime.pageController.getSessionStorage = async () => ({nonce: 'n-1'});
      runtime.pageController.getPage = async () => ({
        url: () => 'https://example.com/product',
        title: async () => 'Product',
      } as Awaited<ReturnType<typeof runtime.pageController.getPage>>);

      const response = makeResponse();
      await exportRebuildBundle.handler({
        params: {
          taskId: 'task-002',
          taskSlug: 'auto-demo',
          targetUrl: 'https://example.com/product',
          goal: 'rebuild signature',
          autoGenerate: true,
        },
      } as Parameters<typeof exportRebuildBundle.handler>[0], response as unknown as Parameters<typeof exportRebuildBundle.handler>[1], {} as Parameters<typeof exportRebuildBundle.handler>[2]);

      const entryCode = await readFile(path.join(rootDir, 'task-002', 'env', 'entry.js'), 'utf8');
      const envCode = await readFile(path.join(rootDir, 'task-002', 'env', 'env.js'), 'utf8');
      const capture = JSON.parse(await readFile(path.join(rootDir, 'task-002', 'env', 'capture.json'), 'utf8')) as Record<string, unknown>;

      assert.ok(entryCode.includes('signPayload'));
      assert.ok(entryCode.includes('capture.targetScript'));
      assert.ok(envCode.includes('globalThis.window = globalThis'));
      assert.ok(envCode.includes('globalThis.localStorage'));
      assert.strictEqual((capture.page as Record<string, unknown>).url, 'https://example.com/product');
      assert.strictEqual(((capture.cookies as Array<Record<string, unknown>>)[0]).name, 'sid');
      assert.strictEqual(((capture.runtimeEvidence as Array<Record<string, unknown>>)[0]).functionName, 'signPayload');
    } finally {
      runtime.reverseTaskStore = originalStore;
      runtime.collector.getTopPriorityFiles = originals.getTopPriorityFiles;
      runtime.pageController.getCookies = originals.getCookies;
      runtime.pageController.getLocalStorage = originals.getLocalStorage;
      runtime.pageController.getSessionStorage = originals.getSessionStorage;
      runtime.pageController.getPage = originals.getPage;
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  it('filters auto-generated evidence by target keywords instead of logging unrelated page noise', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'js-reverse-rebuild-filtered-'));
    const runtime = getJSHookRuntime();
    const originalStore = runtime.reverseTaskStore;
    const originals = {
      getTopPriorityFiles: runtime.collector.getTopPriorityFiles,
      getCookies: runtime.pageController.getCookies,
      getLocalStorage: runtime.pageController.getLocalStorage,
      getSessionStorage: runtime.pageController.getSessionStorage,
      getPage: runtime.pageController.getPage,
    };
    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const task = await runtime.reverseTaskStore.openTask({
        taskId: 'task-003',
        slug: 'jd-h5st',
        targetUrl: 'https://item.jd.com/1001.html',
        goal: 'find h5st',
      });
      await task.appendLog('runtime-evidence', {
        source: 'hook',
        requestUrl: 'https://api.m.jd.com/client.action?functionId=pc_search&h5st=abc123',
        functionName: 'genH5st',
        bodyPreview: '{"h5st":"abc123"}',
      });
      await task.appendLog('runtime-evidence', {
        source: 'hook',
        requestUrl: 'https://example.com/analytics',
        functionName: 'trackAd',
        bodyPreview: '{"event":"ad"}',
      });

      runtime.collector.getTopPriorityFiles = () => ({
        files: [
          {
            url: 'https://storage.360buyimg.com/js/h5st.js',
            content: 'function genH5st() { return "abc123"; }',
            size: 40,
            type: 'external',
          },
          {
            url: 'https://storage.360buyimg.com/js/analytics.js',
            content: 'function trackAd() { return "ad"; }',
            size: 34,
            type: 'external',
          },
        ],
        totalSize: 74,
        totalFiles: 2,
      });
      runtime.pageController.getCookies = async () => [{name: 'pin', value: 'jd-user'}];
      runtime.pageController.getLocalStorage = async () => ({h5st_seed: 'seed-1', ad_cache: 'skip'});
      runtime.pageController.getSessionStorage = async () => ({h5st_nonce: 'n-1'});
      runtime.pageController.getPage = async () => ({
        url: () => 'https://item.jd.com/1001.html',
        title: async () => 'JD Product',
      } as Awaited<ReturnType<typeof runtime.pageController.getPage>>);

      const response = makeResponse();
      await exportRebuildBundle.handler({
        params: {
          taskId: 'task-003',
          taskSlug: 'jd-h5st',
          targetUrl: 'https://item.jd.com/1001.html',
          goal: 'find h5st',
          autoGenerate: true,
          targetKeywords: ['h5st'],
          targetUrlPatterns: ['api.m.jd.com'],
          maxEvidenceItems: 2,
        },
      } as unknown as Parameters<typeof exportRebuildBundle.handler>[0], response as unknown as Parameters<typeof exportRebuildBundle.handler>[1], {} as Parameters<typeof exportRebuildBundle.handler>[2]);

      const capture = JSON.parse(await readFile(path.join(rootDir, 'task-003', 'env', 'capture.json'), 'utf8')) as Record<string, unknown>;
      const runtimeEvidence = capture.runtimeEvidence as Array<Record<string, unknown>>;
      const filteredScript = capture.targetScript as Record<string, unknown>;

      assert.strictEqual(runtimeEvidence.length, 1);
      assert.strictEqual(runtimeEvidence[0].functionName, 'genH5st');
      assert.strictEqual(filteredScript.url, 'https://storage.360buyimg.com/js/h5st.js');
      assert.ok(!JSON.stringify(capture).includes('trackAd'));
      assert.ok(!JSON.stringify(capture).includes('analytics'));
    } finally {
      runtime.reverseTaskStore = originalStore;
      runtime.collector.getTopPriorityFiles = originals.getTopPriorityFiles;
      runtime.pageController.getCookies = originals.getCookies;
      runtime.pageController.getLocalStorage = originals.getLocalStorage;
      runtime.pageController.getSessionStorage = originals.getSessionStorage;
      runtime.pageController.getPage = originals.getPage;
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  it('matches weird targets through function names and action descriptions without relying on obvious parameter names', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'js-reverse-rebuild-function-target-'));
    const runtime = getJSHookRuntime();
    const originalStore = runtime.reverseTaskStore;
    const originals = {
      getTopPriorityFiles: runtime.collector.getTopPriorityFiles,
      getCookies: runtime.pageController.getCookies,
      getLocalStorage: runtime.pageController.getLocalStorage,
      getSessionStorage: runtime.pageController.getSessionStorage,
      getPage: runtime.pageController.getPage,
    };
    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});

    try {
      const task = await runtime.reverseTaskStore.openTask({
        taskId: 'task-004',
        slug: 'weird-param',
        targetUrl: 'https://example.com/order',
        goal: 'find weird param',
      });
      await task.appendLog('runtime-evidence', {
        source: 'hook',
        actionDescription: 'click submit order button',
        functionName: 'computeQtk9',
        requestUrl: 'https://example.com/api/checkout',
        bodyPreview: '{"qtk9":"abc"}',
      });
      await task.appendLog('runtime-evidence', {
        source: 'hook',
        actionDescription: 'page idle telemetry',
        functionName: 'trackHeartbeat',
        requestUrl: 'https://example.com/api/metrics',
        bodyPreview: '{"ping":1}',
      });

      runtime.collector.getTopPriorityFiles = () => ({
        files: [
          {
            url: 'https://example.com/static/checkout.js',
            content: 'function computeQtk9() { return "abc"; }',
            size: 42,
            type: 'external',
          },
          {
            url: 'https://example.com/static/telemetry.js',
            content: 'function trackHeartbeat() { return 1; }',
            size: 38,
            type: 'external',
          },
        ],
        totalSize: 80,
        totalFiles: 2,
      });
      runtime.pageController.getCookies = async () => [{name: 'sid', value: 'checkout-user'}];
      runtime.pageController.getLocalStorage = async () => ({order_seed: 'seed-2'});
      runtime.pageController.getSessionStorage = async () => ({order_nonce: 'nonce-2'});
      runtime.pageController.getPage = async () => ({
        url: () => 'https://example.com/order',
        title: async () => 'Checkout',
      } as Awaited<ReturnType<typeof runtime.pageController.getPage>>);

      const response = makeResponse();
      await exportRebuildBundle.handler({
        params: {
          taskId: 'task-004',
          taskSlug: 'weird-param',
          targetUrl: 'https://example.com/order',
          goal: 'find weird param',
          autoGenerate: true,
          targetFunctionNames: ['computeQtk9'],
          targetActionDescription: 'submit order button',
        },
      } as unknown as Parameters<typeof exportRebuildBundle.handler>[0], response as unknown as Parameters<typeof exportRebuildBundle.handler>[1], {} as Parameters<typeof exportRebuildBundle.handler>[2]);

      const capture = JSON.parse(await readFile(path.join(rootDir, 'task-004', 'env', 'capture.json'), 'utf8')) as Record<string, unknown>;
      const runtimeEvidence = capture.runtimeEvidence as Array<Record<string, unknown>>;
      const filteredScript = capture.targetScript as Record<string, unknown>;

      assert.strictEqual(runtimeEvidence.length, 1);
      assert.strictEqual(runtimeEvidence[0].functionName, 'computeQtk9');
      assert.strictEqual(filteredScript.url, 'https://example.com/static/checkout.js');
      assert.ok(!JSON.stringify(capture).includes('trackHeartbeat'));
      assert.ok(!JSON.stringify(capture).includes('telemetry'));
    } finally {
      runtime.reverseTaskStore = originalStore;
      runtime.collector.getTopPriorityFiles = originals.getTopPriorityFiles;
      runtime.pageController.getCookies = originals.getCookies;
      runtime.pageController.getLocalStorage = originals.getLocalStorage;
      runtime.pageController.getSessionStorage = originals.getSessionStorage;
      runtime.pageController.getPage = originals.getPage;
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
