type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CacheStore = Map<string, CacheEntry<unknown>>;

const getCacheStore = (): CacheStore => {
  const globalScope = globalThis as typeof globalThis & {
    __SHOPSTACK_CACHE__?: CacheStore;
  };

  if (!globalScope.__SHOPSTACK_CACHE__) {
    globalScope.__SHOPSTACK_CACHE__ = new Map();
  }

  return globalScope.__SHOPSTACK_CACHE__;
};

export function getCachedValue<T>(key: string): T | null {
  const store = getCacheStore();
  const entry = store.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setCachedValue<T>(key: string, value: T, ttlMs: number) {
  const store = getCacheStore();
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearCachedValue(key: string) {
  const store = getCacheStore();
  store.delete(key);
}

