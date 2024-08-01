var decoder = new TextDecoder("utf8");
var encoder = new TextEncoder();

function isErrorMessage(error) {
    return (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
    );
}

// function getIndex(bigIndex: bigint): number {
//     const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
//     const minSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);

//     if (bigIndex > maxSafeInteger || bigIndex < minSafeInteger) {
//         throw new ErrorOther("Cursor value out of range");
//     }

//     return Number(bigIndex);
// }

///////////////////////////////////////////////// ATOMICS
function increment(bucket, key, delta) {
    console.warn("Atomic increment not actually atomic");
    const value = bucket.get(key);

    let newValue;
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
function getMany(bucket, keys) {
    return keys.map((key) => {
        const value = bucket.get(key);
        return value ? [key, value] : undefined;
    });
}

function setMany(bucket, keyValues) {
    keyValues.forEach(([key, value]) => {
        bucket.set(key, value);
    });
}

function deleteMany(bucket, keys) {
    keys.forEach((key) => {
        bucket.delete(key);
    });
}
export const batch = {
    getMany,
    setMany,
    deleteMany,
};

export class ErrorNoSuchStore {
    tag = "no-such-store";
}

export class ErrorAccessDenied {
    tag = "access-denied";
}

export class ErrorOther {
    tag = "other";

    constructor(message) {
        this.val = message;
    }
}

function open(identifier) {
    const validIdentifierRegex = /^[0-9a-zA-Z-]+$/;
    if (!validIdentifierRegex.test(identifier)) {
        throw new ErrorOther(
            "Invalid bucket identifier: Identifier must conform to /^[0-9a-zA-Z-]+$/",
        );
    }

    return new Bucket(identifier);
}

class Bucket {
    constructor(identifier) {
        this.bucketId = `${host.myServiceAccount()}:${identifier}`;
    }

    validateKey(key) {
        // ~40 bytes per key, so `listKeys` pagesize limit of 1000 yield a 40kb payload
        if (key.length >= 20) {
            throw new ErrorOther("key must be less than 20 characters");
        }
    }

    get(key) {
        this.validateKey(key);
        try {
            const item = localStorage.getItem(`${this.bucketId}:${key}`);
            return item ? encoder.encode(atob(item)) : undefined;
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

    set(key, value) {
        this.validateKey(key);

        // 100kb
        const maxSize = 100 * 1024;
        if (value.length >= maxSize) {
            throw new ErrorOther("value must be less than 100KB");
        }

        try {
            localStorage.setItem(
                `${this.bucketId}:${key}`,
                btoa(decoder.decode(value)),
            );
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

    delete(key) {
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

    exists(key) {
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

    // listKeys(cursor?: bigint): KeyResponse {
    //     const prefix = `${this.bucketId}:`;
    //     const pageLimit = 1000;
    //     const startIndex: number = cursor ? getIndex(cursor) : 0;

    //     const keys: string[] = [];
    //     let moreRecords: boolean = false;
    //     let nr = 0;
    //     for (let i = startIndex; i < localStorage.length; i++) {
    //         const fullKey = localStorage.key(i);
    //         if (fullKey && fullKey.startsWith(prefix)) {
    //             keys.push(fullKey.slice(prefix.length));
    //             nr++;

    //             if (nr >= pageLimit) {
    //                 moreRecords = i + 1 < localStorage.length;
    //                 break;
    //             }
    //         }
    //     }

    //     let nextCursor: bigint | undefined = undefined;
    //     if (moreRecords) {
    //         nextCursor = BigInt(startIndex + keys.length);
    //     }

    //     return { keys, cursor: nextCursor };
    // }
}

export const store = {
    Bucket,
    open,
};
