declare module 'hash.js' {
    interface Hash {
        update(data: string | Buffer | number[]): Hash;
        digest(encoding?: string): string | number[];
    }

    interface HashConstructor {
        (algorithm: string): Hash;
        sha256(): Hash;
        sha512(): Hash;
    }

    const hash: HashConstructor;
    export default hash;
}