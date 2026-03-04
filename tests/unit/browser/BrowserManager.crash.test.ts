/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { BrowserManager } from '../../../src/browser.js';

interface BrowserLike {
  connected: boolean;
  on(event: string, handler: () => void): void;
  close(): Promise<void>;
}

interface BrowserManagerCrashHarness {
  browser?: BrowserLike;
  crashCheckInterval?: ReturnType<typeof setInterval>;
  isRestarting: boolean;
  setupCrashDetection(): void;
  handleBrowserCrash(): Promise<void>;
  ensureBrowser(): Promise<BrowserLike>;
  close(): Promise<void>;
}

describe('BrowserManager crash handling', () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    BrowserManager.resetInstance();
  });

  afterEach(async () => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    global.setTimeout = originalSetTimeout;
    try {
      const manager = BrowserManager.getInstance({ headless: true, isolated: true });
      await manager.close();
    } catch {
      // no-op
    }
    BrowserManager.resetInstance();
  });

  it('setupCrashDetection registers handlers and periodic check triggers crash handling', () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    }) as unknown as BrowserManagerCrashHarness;

    let disconnectedHandler: (() => void) | undefined;
    manager.browser = {
      connected: true,
      on: (event: string, handler: () => void) => {
        if (event === 'disconnected') {
          disconnectedHandler = handler;
        }
      },
      close: async () => undefined,
    };

    let intervalTick: (() => void) | undefined;
    global.setInterval = ((fn: () => void) => {
      intervalTick = fn;
      return 99 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    global.clearInterval = (() => undefined) as typeof clearInterval;

    let crashed = 0;
    manager.handleBrowserCrash = async () => {
      crashed += 1;
    };

    manager.setupCrashDetection();
    assert.ok(disconnectedHandler);
    disconnectedHandler!();
    assert.strictEqual(crashed, 1);

    manager.browser.connected = false;
    intervalTick!();
    assert.strictEqual(crashed, 2);
  });

  it('setupCrashDetection clears existing interval and skips when browser is absent', () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    }) as unknown as BrowserManagerCrashHarness;
    manager.browser = undefined;
    manager.setupCrashDetection();

    let clearedId: ReturnType<typeof setInterval> | undefined;
    global.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      clearedId = id;
    }) as typeof clearInterval;
    global.setInterval = ((fn: () => void) => {
      void fn;
      return 12 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;

    manager.browser = {
      connected: true,
      on: () => undefined,
      close: async () => undefined,
    };
    manager.crashCheckInterval = 7 as unknown as ReturnType<typeof setInterval>;
    manager.setupCrashDetection();
    assert.strictEqual(clearedId, 7 as unknown as ReturnType<typeof setInterval>);
  });

  it('handleBrowserCrash restarts browser and always resets restarting flag', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    }) as unknown as BrowserManagerCrashHarness;
    let closed = 0;
    manager.browser = {
      connected: false,
      on: () => undefined,
      close: async () => {
        closed += 1;
        throw new Error('close failed');
      },
    };

    global.setTimeout = ((fn: (...args: unknown[]) => void) => {
      fn();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    let ensured = 0;
    manager.ensureBrowser = async () => {
      ensured += 1;
      return {
        connected: true,
        on: () => undefined,
        close: async () => undefined,
      };
    };

    await manager.handleBrowserCrash();
    assert.strictEqual(closed, 1);
    assert.strictEqual(ensured, 1);
    assert.strictEqual(manager.isRestarting, false);
  });

  it('handleBrowserCrash early returns when already restarting', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    }) as unknown as BrowserManagerCrashHarness;
    manager.isRestarting = true;
    let ensured = 0;
    manager.ensureBrowser = async () => {
      ensured += 1;
      return {
        connected: true,
        on: () => undefined,
        close: async () => undefined,
      };
    };

    await manager.handleBrowserCrash();
    assert.strictEqual(ensured, 0);
    assert.strictEqual(manager.isRestarting, true);
  });
});
