// For now, this file needs to be manually compiled to `../wasi-keyvalue.js` so that loader can import it.
// Todo: Build system could automate this.

declare const host: any;

function isErrorMessage(error: any): error is { message: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
    );
}

function getIndex(bigIndex: bigint): number {
    const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
    const minSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);

    if (bigIndex > maxSafeInteger || bigIndex < minSafeInteger) {
        throw new ErrorOther("Cursor value out of range");
    }

    return Number(bigIndex);
}

///////////////////////////////////////////////// ATOMICS
function increment(bucket: Bucket, key: string, delta: bigint): bigint {
    console.warn("Atomic increment not actually atomic");
    const value = bucket.get(key);

    let newValue: bigint;
    if (value) {
        const decodedValue = new TextDecoder().decode(value);
        if (!/^\d+$/.test(decodedValue)) {
            throw new ErrorOther("Cannot increment; the value is not numeric.");
        }
        newValue = BigInt(decodedValue) + delta;
    } else {
        newValue = delta;
    }

    const packed = new TextEncoder().encode(String(newValue));
    bucket.set(key, packed);
    return newValue;
}
export const atomics = { increment };

///////////////////////////////////////////////// BATCH
function getMany(
    bucket: Bucket,
    keys: string[],
): ([string, Uint8Array] | undefined)[] {
    return keys.map((key) => {
        const value = bucket.get(key);
        return value ? [key, value] : undefined;
    });
}

function setMany(bucket: Bucket, keyValues: [string, Uint8Array][]): void {
    keyValues.forEach(([key, value]) => {
        bucket.set(key, value);
    });
}

function deleteMany(bucket: Bucket, keys: string[]): void {
    keys.forEach((key) => {
        bucket.delete(key);
    });
}
export const batch = { getMany, setMany, deleteMany };

///////////////////////////////////////////////// STORE
export interface ErrorNoSuchStore {
    tag: "no-such-store";
}
export class ErrorNoSuchStore implements ErrorNoSuchStore {
    tag: "no-such-store" = "no-such-store";
}

export interface ErrorAccessDenied {
    tag: "access-denied";
}
export class ErrorAccessDenied implements ErrorAccessDenied {
    tag: "access-denied" = "access-denied";
}

export interface ErrorOther {
    tag: "other";
    val: string;
}
export class ErrorOther implements ErrorOther {
    tag: "other" = "other";
    val: string;

    constructor(message: string) {
        this.val = message;
    }
}

export type Error = ErrorNoSuchStore | ErrorAccessDenied | ErrorOther;

export interface KeyResponse {
    keys: string[];
    cursor?: bigint;
}

function open(identifier: string): Bucket {
    const validIdentifierRegex = /^[0-9a-zA-Z-]+$/;
    if (!validIdentifierRegex.test(identifier)) {
        throw new ErrorOther(
            "Invalid bucket identifier: Identifier must conform to /^[0-9a-zA-Z-]+$/",
        );
    }

    return new Bucket(identifier);
}

class Bucket {
    private bucketId: string;

    constructor(identifier: string) {
        this.bucketId = `${host.myServiceAccount()}:${identifier}`;
    }

    private validateKey(key: string) {
        // ~40 bytes per key, so `listKeys` pagesize limit of 1000 yield a 40kb payload
        if (key.length >= 20) {
            throw new ErrorOther("key must be less than 20 characters");
        }
    }

    get(key: string): Uint8Array | undefined {
        this.validateKey(key);
        try {
            const item = localStorage.getItem(`${this.bucketId}:${key}`);
            return item
                ? new Uint8Array(item.split(",").map(Number))
                : undefined;
        } catch (e) {
            if (isErrorMessage(e)) {
                throw new ErrorOther(e.message);
            } else {
                throw new ErrorOther(
                    `[Unknown error]\n${JSON.stringify(e, null, 2)}`,
                );
            }
        }
    }

    set(key: string, value: Uint8Array): void {
        this.validateKey(key);

        // 100kb
        const maxSize = 100 * 1024;
        if (value.length >= maxSize) {
            throw new ErrorOther("value must be less than 100KB");
        }

        try {
            localStorage.setItem(`${this.bucketId}:${key}`, value.toString());
        } catch (e) {
            if (isErrorMessage(e)) {
                throw new ErrorOther(e.message);
            } else {
                throw new ErrorOther(
                    `[Unknown error]\n${JSON.stringify(e, null, 2)}`,
                );
            }
        }
    }

    delete(key: string): void {
        this.validateKey(key);

        try {
            localStorage.removeItem(`${this.bucketId}:${key}`);
        } catch (e) {
            if (isErrorMessage(e)) {
                throw new ErrorOther(e.message);
            } else {
                throw new ErrorOther(
                    `[Unknown error]\n${JSON.stringify(e, null, 2)}`,
                );
            }
        }
    }

    exists(key: string): boolean {
        try {
            this.validateKey(key);
        } catch (e) {
            return false;
        }

        try {
            return localStorage.getItem(`${this.bucketId}:${key}`) !== null;
        } catch (e) {
            if (isErrorMessage(e)) {
                throw new ErrorOther(e.message);
            } else {
                throw new ErrorOther(
                    `[Unknown error]\n${JSON.stringify(e, null, 2)}`,
                );
            }
        }
    }

    listKeys(cursor?: bigint): KeyResponse {
        const prefix = `${this.bucketId}:`;
        const pageLimit = 1000;
        const startIndex: number = cursor ? getIndex(cursor) : 0;

        const keys: string[] = [];
        let moreRecords: boolean = false;
        let nr = 0;
        for (let i = startIndex; i < localStorage.length; i++) {
            const fullKey = localStorage.key(i);
            if (fullKey && fullKey.startsWith(prefix)) {
                keys.push(fullKey.slice(prefix.length));
                nr++;

                if (nr >= pageLimit) {
                    moreRecords = i + 1 < localStorage.length;
                    break;
                }
            }
        }

        let nextCursor: bigint | undefined = undefined;
        if (moreRecords) {
            nextCursor = BigInt(startIndex + keys.length);
        }

        return { keys, cursor: nextCursor };
    }
}

export const store = { Bucket, open };
