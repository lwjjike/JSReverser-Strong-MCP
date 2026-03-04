
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { getJSHookRuntime } from '../../../src/tools/runtime.js';
import { evaluateScript, injectPreloadScript } from '../../../src/tools/script.js';

interface HandleLike {
  dispose(): Promise<void>;
}

interface PageLike {
  evaluateHandle(): Promise<HandleLike>;
  evaluate(
    callback: (fn: () => Promise<{ok: boolean}>) => Promise<string>,
    passedFn?: () => Promise<{ok: boolean}>,
  ): Promise<string>;
}

interface FrameLike extends PageLike {}

interface ContextLike {
  getSelectedPage(): PageLike;
  getSelectedFrame(): FrameLike;
  waitForEventsAfterAction(action: () => Promise<void>): Promise<void>;
}

interface ResponseLike {
  appendResponseLine(value: string): void;
  setIncludePages(): void;
  setIncludeNetworkRequests(): void;
  setIncludeConsoleData(): void;
  attachImage(): void;
  attachNetworkRequest(): void;
  attachConsoleMessage(): void;
  setIncludeWebSocketConnections(): void;
  attachWebSocket(): void;
}

describe('evaluate_script callback path', () => {
  it('executes page.evaluate callback body and disposes handle', async () => {
    const lines: string[] = [];
    let disposed = 0;

    const fn = async () => ({ ok: true });

    const handle = {
      dispose: async () => {
        disposed += 1;
      },
    } satisfies HandleLike;

    const page: PageLike = {
      evaluateHandle: async () => handle,
      evaluate: async (callback, passedFn) => callback(passedFn ?? fn),
    };

    const context: ContextLike = {
      getSelectedPage: () => page,
      getSelectedFrame: () => page,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    const response: ResponseLike = {
      appendResponseLine: (v: string) => lines.push(v),
      setIncludePages: () => undefined,
      setIncludeNetworkRequests: () => undefined,
      setIncludeConsoleData: () => undefined,
      attachImage: () => undefined,
      attachNetworkRequest: () => undefined,
      attachConsoleMessage: () => undefined,
      setIncludeWebSocketConnections: () => undefined,
      attachWebSocket: () => undefined,
    };

    await evaluateScript.handler({ params: { function: '() => ({ ok: true })' } } as Parameters<typeof evaluateScript.handler>[0], response as Parameters<typeof evaluateScript.handler>[1], {
      ...context,
      getSelectedPage: () => ({
        ...page,
        evaluate: async (callback: unknown) => {
          if (typeof callback !== 'function') {
            throw new Error('expected callback evaluate path');
          }
          return callback(fn);
        },
      }),
      getSelectedFrame: () => ({
        ...page,
        evaluate: async (callback: unknown) => {
          if (typeof callback !== 'function') {
            throw new Error('expected callback evaluate path');
          }
          return callback(fn);
        },
      }),
    } as unknown as Parameters<typeof evaluateScript.handler>[2]);

    assert.strictEqual(disposed, 1);
    assert.ok(lines.some((l) => l.includes('Script ran on page and returned')));
    assert.ok(lines.some((l) => l.includes('{"ok":true}')));
  });

  it('registers a preload script on future documents', async () => {
    const lines: string[] = [];
    let injected: string | undefined;

    const response: ResponseLike = {
      appendResponseLine: (v: string) => lines.push(v),
      setIncludePages: () => undefined,
      setIncludeNetworkRequests: () => undefined,
      setIncludeConsoleData: () => undefined,
      attachImage: () => undefined,
      attachNetworkRequest: () => undefined,
      attachConsoleMessage: () => undefined,
      setIncludeWebSocketConnections: () => undefined,
      attachWebSocket: () => undefined,
    };

    const runtime = getJSHookRuntime();
    const originalInject = runtime.pageController.injectScriptOnNewDocument.bind(runtime.pageController);
    runtime.pageController.injectScriptOnNewDocument = async (scriptContent: string) => {
      injected = scriptContent;
    };

    try {
      await injectPreloadScript.handler(
        { params: { script: 'window.__preload = 1;' } } as Parameters<typeof injectPreloadScript.handler>[0],
        response as Parameters<typeof injectPreloadScript.handler>[1],
        {} as Parameters<typeof injectPreloadScript.handler>[2],
      );
    } finally {
      runtime.pageController.injectScriptOnNewDocument = originalInject;
    }

    assert.strictEqual(injected, 'window.__preload = 1;');
    assert.ok(lines.some((line) => line.includes('Preload script registered')));
  });

  it('runs evaluate_script in the selected frame execution context', async () => {
    const lines: string[] = [];
    let pageUsed = false;
    let frameUsed = false;

    const frameHandle = {
      dispose: async () => undefined,
    } satisfies HandleLike;

    const page: PageLike = {
      evaluateHandle: async () => {
        pageUsed = true;
        throw new Error('page should not be used when a frame is selected');
      },
      evaluate: async () => {
        pageUsed = true;
        throw new Error('page should not be used when a frame is selected');
      },
    };

    const frame: FrameLike = {
      evaluateHandle: async () => {
        frameUsed = true;
        return frameHandle;
      },
      evaluate: async (callback) => {
        frameUsed = true;
        if (typeof callback !== 'function') {
          throw new Error('expected callback evaluate path');
        }
        return callback(async () => ({ok: true}));
      },
    };

    const response: ResponseLike = {
      appendResponseLine: (v: string) => lines.push(v),
      setIncludePages: () => undefined,
      setIncludeNetworkRequests: () => undefined,
      setIncludeConsoleData: () => undefined,
      attachImage: () => undefined,
      attachNetworkRequest: () => undefined,
      attachConsoleMessage: () => undefined,
      setIncludeWebSocketConnections: () => undefined,
      attachWebSocket: () => undefined,
    };

    await evaluateScript.handler(
      { params: { function: '() => ({ ok: true })' } } as Parameters<typeof evaluateScript.handler>[0],
      response as Parameters<typeof evaluateScript.handler>[1],
      {
        getSelectedPage: () => page,
        getSelectedFrame: () => frame,
        waitForEventsAfterAction: async (action: () => Promise<void>) => {
          await action();
        },
      } as unknown as Parameters<typeof evaluateScript.handler>[2],
    );

    assert.strictEqual(pageUsed, false);
    assert.strictEqual(frameUsed, true);
    assert.ok(lines.some((line) => line.includes('{"ok":true}')));
  });
});
