/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DebuggerContext} from '../../src/DebuggerContext.js';

type Handler = (payload: any) => void;

class FakeCDPSession {
  readonly calls: Array<{method: string; params?: unknown}> = [];
  #handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): void {
    const arr = this.#handlers.get(event) ?? [];
    arr.push(handler);
    this.#handlers.set(event, arr);
  }

  off(event: string, handler: Handler): void {
    const arr = this.#handlers.get(event) ?? [];
    this.#handlers.set(
      event,
      arr.filter((h) => h !== handler),
    );
  }

  async send(method: string, params?: any): Promise<any> {
    this.calls.push({method, params});
    if (method === 'Debugger.setBreakpointByUrl') {
      return {breakpointId: 'bp-1', locations: []};
    }
    return {};
  }

  emit(event: string, payload: any): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe('DebuggerContext auto recovery', () => {
  it('auto resumes and removes breakpoint when same breakpoint loops', async () => {
    const context = new DebuggerContext();
    const client = new FakeCDPSession();
    await context.enable(client as any);
    await context.setBreakpoint('https://a.js', 1, 0);

    const pausedEvent = {
      reason: 'other',
      hitBreakpoints: ['bp-1'],
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'fn',
          url: 'https://a.js',
          location: {scriptId: 's1', lineNumber: 1, columnNumber: 0},
          scopeChain: [],
          this: {type: 'object'},
        },
      ],
    };

    client.emit('Debugger.paused', pausedEvent);
    client.emit('Debugger.paused', pausedEvent);
    client.emit('Debugger.paused', pausedEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resumeCalls = client.calls.filter((x) => x.method === 'Debugger.resume');
    const removeCalls = client.calls.filter((x) => x.method === 'Debugger.removeBreakpoint');
    assert.ok(resumeCalls.length >= 1);
    assert.ok(removeCalls.some((x) => (x.params as {breakpointId?: string})?.breakpointId === 'bp-1'));

    const recovery = context.getLastAutoRecoveryEvent();
    assert.ok(recovery);
    assert.strictEqual(recovery?.breakpointId, 'bp-1');
    assert.ok((recovery?.hitCount ?? 0) >= 3);
  });
});
