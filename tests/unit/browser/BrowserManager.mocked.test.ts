
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import { beforeEach, afterEach, describe, it } from 'node:test';

import { BrowserManager } from '../../../src/browser.js';
import { StealthScripts2025 } from '../../../src/modules/stealth/StealthScripts2025.js';

interface ResettableStealthScripts {
  injectAll: typeof StealthScripts2025.injectAll;
}

interface BrowserLike {
  connected: boolean;
  close(): Promise<void>;
  on(event: string, handler: unknown): void;
  pages?(): Promise<unknown[]>;
}

interface BrowserManagerLike {
  browser?: BrowserLike;
  connectToRemoteBrowser(): Promise<BrowserLike>;
  launchBrowser(): Promise<BrowserLike>;
  close(): Promise<void>;
  ensureBrowser(): Promise<BrowserLike>;
}

describe('BrowserManager mocked', () => {
  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(() => {
    BrowserManager.resetInstance();
    originalInjectAll = StealthScripts2025.injectAll;
  });

  afterEach(async () => {
    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll = originalInjectAll;
    try {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });
      await manager.close();
    } catch {
      // no-op
    }
    BrowserManager.resetInstance();
  });

  it('uses connected browser directly in ensureBrowser', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    const existing = { connected: true };
    (manager as unknown as BrowserManagerLike).browser = existing as BrowserLike;

    const browser = await manager.ensureBrowser();
    assert.strictEqual(browser, existing);
  });

  it('selects remote connect or launch path', async () => {
    const remote = BrowserManager.getInstance({
      remoteDebuggingUrl: 'http://127.0.0.1:9222',
      headless: true,
      isolated: true,
    });
    let remoteCalled = 0;
    (remote as unknown as BrowserManagerLike).connectToRemoteBrowser = async () => {
      remoteCalled += 1;
      return {
        connected: true,
        close: async () => undefined,
        on: () => undefined,
      };
    };
    await remote.ensureBrowser();
    assert.strictEqual(remoteCalled, 1);

    BrowserManager.resetInstance();

    const local = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    let launchCalled = 0;
    (local as unknown as BrowserManagerLike).launchBrowser = async () => {
      launchCalled += 1;
      return {
        connected: true,
        close: async () => undefined,
        on: () => undefined,
      };
    };
    await local.ensureBrowser();
    assert.strictEqual(launchCalled, 1);
  });

  it('injects stealth scripts once and handles new page targets', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    const pageA = { id: 'a' };
    const pageB = { id: 'b' };
    type TargetCreatedHandler = (target: {type(): string; page(): Promise<{id: string}>}) => Promise<void>;
    let onTargetCreated: TargetCreatedHandler | null = null;
    const browser: BrowserLike = {
      pages: async () => [pageA, pageB],
      on: (event: string, handler: unknown) => {
        if (event === 'targetcreated') {
          onTargetCreated = handler as TargetCreatedHandler;
        }
      },
      close: async () => undefined,
      connected: true,
    };
    (manager as unknown as BrowserManagerLike).browser = browser;

    let injectedCount = 0;
    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll = async () => {
      injectedCount += 1;
      return {
        preset: 'linux-chrome',
        injectedFeatures: ['mockChrome'],
        skippedFeatures: [],
        userAgent: 'mock-agent',
        platform: 'Linux x86_64',
      };
    };

    await manager.injectStealth('linux-chrome', { mockConnection: false });
    assert.strictEqual(injectedCount, 2);

    await manager.injectStealth();
    assert.strictEqual(injectedCount, 2);

    if (!onTargetCreated) {
      throw new Error('expected targetcreated handler');
    }
    const targetCreatedHandler: TargetCreatedHandler = onTargetCreated;
    await targetCreatedHandler({
      type: () => 'page',
      page: async () => ({ id: 'c' }),
    });
    assert.strictEqual(injectedCount, 3);
  });

  it('handles injectStealth failures and connection helpers', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    await assert.rejects(
      async () => {
        await manager.injectStealth();
      },
      /Browser not initialized/,
    );

    (manager as unknown as BrowserManagerLike).browser = {
      pages: async () => [{}],
      on: () => undefined,
      close: async () => undefined,
      connected: true,
    };

    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll = async () => {
      throw new Error('inject failed');
    };

    await assert.rejects(
      async () => {
        await manager.injectStealth();
      },
      /Failed to inject stealth scripts: inject failed/,
    );

    assert.strictEqual(manager.getStealthFeatures().includes('mockChrome'), true);
    assert.strictEqual(manager.getStealthPresets().length > 0, true);
    assert.strictEqual(manager.isConnected(), true);
  });

  it('restarts and closes browser with cleanup', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    let closeCalled = 0;
    (manager as unknown as BrowserManagerLike).browser = {
      connected: true,
      close: async () => {
        closeCalled += 1;
        throw new Error('close fail');
      },
      on: () => undefined,
    };

    await manager.close();
    assert.strictEqual(closeCalled, 1);
    assert.strictEqual(manager.isConnected(), false);

    let restarted = 0;
    (manager as unknown as BrowserManagerLike).close = async () => {
      restarted += 1;
    };
    (manager as unknown as BrowserManagerLike).ensureBrowser = async () => {
      restarted += 1;
      return {
        connected: true,
        close: async () => undefined,
        on: () => undefined,
      };
    };
    await manager.restart();
    assert.strictEqual(restarted, 2);
  });
});
