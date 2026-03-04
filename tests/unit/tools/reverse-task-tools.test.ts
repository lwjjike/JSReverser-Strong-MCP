/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {ReverseTaskStore} from '../../../src/reverse/ReverseTaskStore.js';
import {analyzeTarget, recordReverseEvidence} from '../../../src/tools/analyzer.js';
import {getHookData} from '../../../src/tools/hook.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';
import type {CollectCodeResult, DetectCryptoResult, UnderstandCodeResult} from '../../../src/types/index.js';

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

describe('reverse task tools', () => {
  it('records reverse evidence and emits rebuild-oriented guidance', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'js-reverse-task-tools-'));
    const runtime = getJSHookRuntime();
    const originals = {
      reverseTaskStore: runtime.reverseTaskStore,
      collectorCollect: runtime.collector.collect,
      collectorGetTopPriorityFiles: runtime.collector.getTopPriorityFiles,
      analyzerUnderstand: runtime.analyzer.understand,
      cryptoDetect: runtime.cryptoDetector.detect,
      hookCreate: runtime.hookManager.create,
      hookRecords: runtime.hookManager.getRecords,
      replayActions: runtime.pageController.replayActions,
    };

    runtime.reverseTaskStore = new ReverseTaskStore({rootDir});
    runtime.collector.collect = async (): Promise<CollectCodeResult> => ({
      files: [{url: 'app.js', content: 'function sign(){return 1}', size: 32, type: 'external'}],
      dependencies: {nodes: [], edges: []},
      totalSize: 32,
      collectTime: 1,
    });
    runtime.collector.getTopPriorityFiles = () => ({
      files: [{
        url: 'top-sign.js',
        content: 'function signToken(token, nonce){ return token + nonce; } fetch("/api/sign", {method: "POST"})',
        size: 96,
        type: 'external',
      }],
      totalSize: 96,
      totalFiles: 1,
    });
    runtime.analyzer.understand = async (): Promise<UnderstandCodeResult> => ({
      structure: {functions: [], classes: [], modules: [], callGraph: {nodes: [], edges: []}},
      techStack: {other: []},
      businessLogic: {mainFeatures: [], entities: [], rules: [], dataModel: {}},
      dataFlow: {graph: {nodes: [], edges: []}, sources: [], sinks: [], taintPaths: []},
      securityRisks: [],
      qualityScore: 88,
    });
    runtime.cryptoDetector.detect = async (): Promise<DetectCryptoResult> => ({
      algorithms: [{
        name: 'SHA256',
        type: 'hash',
        confidence: 0.9,
        location: {file: 'top-sign.js', line: 1},
        usage: 'signature',
      }],
      libraries: [],
      confidence: 0.9,
    });
    runtime.hookManager.create = ({type}: {type: string}) => ({
      hookId: `${type}-hook-1`,
      type,
      script: `/* ${type} */`,
    });
    runtime.hookManager.getRecords = () => ([{
      hookId: 'fetch-hook-1',
      target: 'fetch',
      event: 'request',
      method: 'POST',
      url: 'https://example.com/api/sign?token=abc',
      body: '{"token":"abc","sign":"xyz"}',
      status: 200,
      timestamp: Date.now(),
    }]);
    runtime.pageController.replayActions = async () => [];

    try {
      const recordResponse = makeResponse();
      await recordReverseEvidence.handler({
        params: {
          taskId: 'task-001',
          taskSlug: 'demo',
          targetUrl: 'https://example.com',
          goal: 'rebuild signature',
          channel: 'runtime-evidence',
          targetKeywords: ['sign', 'nonce'],
          targetUrlPatterns: ['https://example.com/api/sign'],
          targetFunctionNames: ['signPayload'],
          targetActionDescription: 'click submit order button',
          entry: {
            source: 'hook',
            note: 'captured sign parameters',
          },
        },
      } as Parameters<typeof recordReverseEvidence.handler>[0], recordResponse as unknown as Parameters<typeof recordReverseEvidence.handler>[1], {} as Parameters<typeof recordReverseEvidence.handler>[2]);

      const recorded = (
        await readFile(path.join(rootDir, 'task-001', 'runtime-evidence.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.strictEqual(recorded.length, 1);
      assert.strictEqual(recorded[0].source, 'hook');
      assert.strictEqual(recorded[0].note, 'captured sign parameters');
      assert.deepStrictEqual(recorded[0].targetContext, {
        targetKeywords: ['sign', 'nonce'],
        targetUrlPatterns: ['https://example.com/api/sign'],
        targetFunctionNames: ['signPayload'],
        targetActionDescription: 'click submit order button',
      });

      const targetContext = JSON.parse(
        await readFile(path.join(rootDir, 'task-001', 'target-context.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.deepStrictEqual(targetContext, {
        targetKeywords: ['sign', 'nonce'],
        targetUrlPatterns: ['https://example.com/api/sign'],
        targetFunctionNames: ['signPayload'],
        targetActionDescription: 'click submit order button',
      });

      const analyzeResponse = makeResponse();
      await analyzeTarget.handler({
        params: {
          url: 'https://example.com',
          hookPreset: 'api-signature',
          autoInjectHooks: false,
        },
      } as Parameters<typeof analyzeTarget.handler>[0], analyzeResponse as unknown as Parameters<typeof analyzeTarget.handler>[1], {} as Parameters<typeof analyzeTarget.handler>[2]);
      const analyzeJson = extractFirstJsonBlock(analyzeResponse.lines);
      assert.ok(Array.isArray(analyzeJson.recommendedNextSteps));
      assert.ok(Array.isArray(analyzeJson.stopIf));
      assert.ok(Array.isArray(analyzeJson.whyTheseSteps));

      const hookResponse = makeResponse();
      await getHookData.handler({
        params: {
          hookId: 'fetch-hook-1',
          view: 'summary',
          maxRecords: 5,
        },
      } as Parameters<typeof getHookData.handler>[0], hookResponse as unknown as Parameters<typeof getHookData.handler>[1], {} as Parameters<typeof getHookData.handler>[2]);
      const hookJson = extractFirstJsonBlock(hookResponse.lines);
      assert.ok(Array.isArray(hookJson.candidateEnvNeeds));
      assert.ok(Array.isArray(hookJson.requestBindings));
    } finally {
      runtime.reverseTaskStore = originals.reverseTaskStore;
      runtime.collector.collect = originals.collectorCollect;
      runtime.collector.getTopPriorityFiles = originals.collectorGetTopPriorityFiles;
      runtime.analyzer.understand = originals.analyzerUnderstand;
      runtime.cryptoDetector.detect = originals.cryptoDetect;
      runtime.hookManager.create = originals.hookCreate;
      runtime.hookManager.getRecords = originals.hookRecords;
      runtime.pageController.replayActions = originals.replayActions;
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
