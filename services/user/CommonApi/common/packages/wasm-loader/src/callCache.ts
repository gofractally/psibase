interface CacheItem {
    [key: string]: any;
}

export class CallCache {
    private cache: CacheItem = {};

    cacheData(key: string, value: any): void {
        this.cache[key] = value;
    }

    exists(key: string): boolean {
        return this.cache.hasOwnProperty(key);
    }

    getCachedData(key: string): any {
        return this.cache[key];
    }

    clearCache(): void {
        this.cache = {};
    }
}
