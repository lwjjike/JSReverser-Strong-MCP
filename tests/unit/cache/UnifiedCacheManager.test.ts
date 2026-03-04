
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {UnifiedCacheManager} from '../../../src/utils/UnifiedCacheManager.js';

interface MockCacheRegistration {
  name: string;
  getStats(): {entries: number; size: number; hits: number; misses: number; hitRate: number};
  clear(): void;
}

describe('UnifiedCacheManager', () => {
  it('registers caches and returns global stats', async () => {
    const manager = UnifiedCacheManager.getInstance();
    const mockCache: MockCacheRegistration = {
      name: 'mock-cache',
      getStats: () => ({entries: 2, size: 1024, hits: 1, misses: 1, hitRate: 0.5}),
      clear: () => undefined,
    };
    manager.registerCache(mockCache);

    const stats = await manager.getGlobalStats();
    assert.ok(stats.totalEntries >= 2);
    assert.ok(stats.totalSize >= 1024);

    manager.unregisterCache('mock-cache');
  });
});
