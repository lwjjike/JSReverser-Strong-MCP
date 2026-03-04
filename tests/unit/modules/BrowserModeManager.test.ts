/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { BrowserModeManager } from '../../../src/modules/browser/BrowserModeManager.js';

interface BrowserLike {
  isConnected?(): boolean;
  newPage?(): Promise<PageLike>;
  disconnect?(): Promise<void>;
}

interface PageLike {
  on(event: string, handler: () => void): void;
  setCacheEnabled(): Promise<void>;
  setBypassCSP(): Promise<void>;
  setJavaScriptEnabled(): Promise<void>;
  setCookie(...args: unknown[]): Promise<number>;
  goto(): Promise<void>;
}

interface BrowserModeManagerHarness {
  browser?: BrowserLike;
  currentPage?: PageLike;
  sessionData?: { cookies?: Array<{ name: string; value: string }> };
  autoLaunched?: boolean;
  browserProcess?: { killed: boolean; kill(): void };
  launch(): Promise<BrowserLike>;
  newPage(): Promise<PageLike>;
  goto(url: string, page?: PageLike): Promise<void>;
  close(): Promise<void>;
  getBrowser(): BrowserLike | null;
  getCurrentPage(): PageLike | null;
  injectAntiDetectionScripts(page: PageLike): Promise<void>;
}

describe('BrowserModeManager (mocked)', () => {
  it('reuses connected browser in launch', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;
    const connected = {
      isConnected: () => true,
    } satisfies BrowserLike;
    manager.browser = connected;

    const browser = await manager.launch();
    assert.strictEqual(browser, connected);
  });

  it('creates new page, restores cookies and handles page close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    let closeHandler: (() => void) | null = null;
    const page = {
      on: (event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      },
      setCacheEnabled: async () => undefined,
      setBypassCSP: async () => undefined,
      setJavaScriptEnabled: async () => undefined,
      setCookie: async (...args: unknown[]) => {
        return args.length;
      },
      goto: async () => undefined,
    } satisfies PageLike;
    const browser = {
      newPage: async () => page,
    } satisfies BrowserLike;

    manager.browser = browser;
    manager.sessionData = { cookies: [{ name: 'sid', value: '1' }] };
    let antiDetectionInjected = 0;
    manager.injectAntiDetectionScripts = async () => {
      antiDetectionInjected += 1;
    };

    const created = await manager.newPage();
    assert.strictEqual(created, page);
    assert.strictEqual(manager.getCurrentPage(), page);
    assert.strictEqual(antiDetectionInjected, 1);

    assert.ok(closeHandler);
  });

  it('navigates with current page or provided page and throws without page', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    await assert.rejects(
      async () => {
        await manager.goto('https://example.com');
      },
      /No page available/,
    );

    let gotoCount = 0;
    const page = {
      goto: async () => {
        gotoCount += 1;
      },
      on: () => undefined,
      setCacheEnabled: async () => undefined,
      setBypassCSP: async () => undefined,
      setJavaScriptEnabled: async () => undefined,
      setCookie: async () => 0,
    } satisfies PageLike;
    manager.currentPage = page;

    await manager.goto('https://a.com');
    await manager.goto('https://b.com', page);
    assert.strictEqual(gotoCount, 2);
  });

  it('disconnects browser and terminates auto-launched process on close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    let disconnected = 0;
    let killed = 0;
    manager.browser = {
      disconnect: async () => {
        disconnected += 1;
      },
    };
    manager.autoLaunched = true;
    manager.browserProcess = {
      killed: false,
      kill: () => {
        killed += 1;
      },
    };

    await manager.close();
    assert.strictEqual(disconnected, 1);
    assert.strictEqual(killed, 1);
    assert.strictEqual(manager.getBrowser(), null);
    assert.strictEqual(manager.getCurrentPage(), null);
  });

  it('handles disconnect failure branch on close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    manager.browser = {
      disconnect: async () => {
        throw new Error('disconnect failed');
      },
    };

    await manager.close();
    assert.strictEqual(manager.getBrowser(), null);
  });
});
