import elliptic from "elliptic";
import hashJs from "hash.js";

// Key type
export const KeyType = {
    k1: 0,
    r1: 1,
};

const publicKeyDataSize = 33;
const privateKeyDataSize = 32;
// const signatureDataSize = 64;

const base58Chars =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function create_base58_map() {
    const base58M: number[] = Array(256).fill(-1);
    for (let i = 0; i < base58Chars.length; ++i) {
        base58M[base58Chars.charCodeAt(i)] = i;
    }
    return base58M;
}

const base58Map: number[] = create_base58_map();

function base58ToBinary(size: number, s: string): Uint8Array {
    const result = new Uint8Array(size);
    for (let i = 0; i < s.length; ++i) {
        let carry = base58Map[s.charCodeAt(i)];
        if (carry < 0) {
            throw new Error("invalid base-58 value");
        }
        for (let j = 0; j < size; ++j) {
            const x = result[j] * 58 + carry;
            result[j] = x;
            carry = x >> 8;
        }
        if (carry) {
            throw new Error("base-58 value is out of range");
        }
    }
    result.reverse();
    return result;
}

function binaryToBase58(bignum: Uint8Array): string {
    const result: number[] = [];
    for (const byte of bignum) {
        let carry = byte;
        for (let j = 0; j < result.length; ++j) {
            const x: number = (base58Map[result[j]] << 8) + carry;
            result[j] = base58Chars.charCodeAt(x % 58);
            carry = (x / 58) | 0;
        }
        while (carry) {
            result.push(base58Chars.charCodeAt(carry % 58));
            carry = (carry / 58) | 0;
        }
    }
    for (const byte of bignum) {
        if (byte) {
            break;
        } else {
            result.push("1".charCodeAt(0));
        }
    }
    result.reverse();
    return String.fromCharCode(...result);
}

function digestSuffixRipemd160(data: Uint8Array, suffix: string) {
    const d: number[] = [];
    for (let i = 0; i < data.length; ++i) {
        d[i] = data[i];
    }
    for (let i = 0; i < suffix.length; ++i) {
        d[data.length + i] = suffix.charCodeAt(i);
    }
    return new (hashJs as any).ripemd160().update(d).digest();
}

function stringToKey(s: string, size: number, suffix: string): Uint8Array {
    const whole = base58ToBinary(size ? size + 4 : 0, s);
    const result = new Uint8Array(whole.buffer, 0, whole.length - 4);
    const digest = digestSuffixRipemd160(result, suffix);
    if (
        digest[0] !== whole[whole.length - 4] ||
        digest[1] !== whole[whole.length - 3] ||
        digest[2] !== whole[whole.length - 2] ||
        digest[3] !== whole[whole.length - 1]
    ) {
        throw new Error("checksum doesn't match");
    }
    return result;
}

function keyToString(data: any, suffix: string, prefix: string): string {
    const digest = digestSuffixRipemd160(data, suffix);
    const whole = new Uint8Array(data.length + 4);
    for (let i = 0; i < data.length; ++i) {
        whole[i] = data[i];
    }
    for (let i = 0; i < 4; ++i) {
        whole[i + data.length] = digest[i];
    }
    return prefix + binaryToBase58(whole);
}

let k1: elliptic.ec | undefined = undefined;
function getK1() {
    if (!k1) k1 = new elliptic.ec("secp256k1");
    return k1;
}

let r1: elliptic.ec | undefined = undefined;
function getR1() {
    if (!r1) r1 = new elliptic.ec("p256");
    return r1;
}

// Convert a private key in string form to {keyType, keyPair}
export function privateStringToKeyPair(s: string) {
    let keyType, data, ec;
    if (s.substr(0, 7) === "PVT_K1_")
        [keyType, data, ec] = [
            KeyType.k1,
            stringToKey(s.substr(7), privateKeyDataSize, "K1"),
            getK1(),
        ];
    else if (s.substr(0, 7) === "PVT_R1_")
        [keyType, data, ec] = [
            KeyType.r1,
            stringToKey(s.substr(7), privateKeyDataSize, "R1"),
            getR1(),
        ];
    else throw new Error("private key must begin with PVT_K1_ or PVT_R1_");
    return { keyType, keyPair: ec.keyFromPrivate(data) };
}

// Convert a public key in string form to {keyType, keyPair}
export function publicStringToKeyPair(s: string) {
    let keyType, data, ec;
    if (s.substr(0, 7) === "PUB_K1_")
        [keyType, data, ec] = [
            KeyType.k1,
            stringToKey(s.substr(7), publicKeyDataSize, "K1"),
            getK1(),
        ];
    else if (s.substr(0, 7) === "PUB_R1_")
        [keyType, data, ec] = [
            KeyType.r1,
            stringToKey(s.substr(7), publicKeyDataSize, "R1"),
            getR1(),
        ];
    else throw new Error("public key must begin with PUB_K1_ or PUB_R1_");
    return { keyType, keyPair: ec.keyPair({ pub: data as Buffer }) };
}

// Convert the private key in {keyType, keyPair} to a string
export function privateKeyPairToString({ keyType, keyPair }: any): string {
    const data = keyPair.getPrivate().toArrayLike(Uint8Array, "be", 32);
    if (keyType === KeyType.k1) return keyToString(data, "K1", "PVT_K1_");
    else if (keyType === KeyType.r1) return keyToString(data, "R1", "PVT_R1_");
    else throw new Error("unsupported key type");
}

// Convert the public key in {keyType, keyPair} to a string
export function publicKeyPairToString({ keyType, keyPair }: any): string {
    const x = keyPair.getPublic().getX().toArray("be", 32);
    const y = keyPair.getPublic().getY().toArray("be", 32);
    const data = [y[31] & 1 ? 3 : 2].concat(x);
    if (keyType === KeyType.k1) return keyToString(data, "K1", "PUB_K1_");
    else if (keyType === KeyType.r1) return keyToString(data, "R1", "PUB_R1_");
    else throw new Error("unsupported key type");
}

// Convert the public key in {keyType, keyPair} to fracpack format
export function publicKeyPairToFracpack({ keyType, keyPair }: any): Uint8Array {
    const x = keyPair.getPublic().getX().toArray("be", 32);
    const y = keyPair.getPublic().getY().toArray("be", 32);
    return new Uint8Array(
        [
            4,
            0,
            0,
            0, // offset to variant
            keyType, // variant index
            33,
            0,
            0,
            0, // variant size
            y[31] & 1 ? 3 : 2, // inner array begins here
        ].concat(x)
    );
}

function PEMtoDER(s: string, tag?: any): Uint8Array {
    const match = s.match(/-----BEGIN (.*?)-----([^]*?)-----END \1-----/);
    if (!match) throw new Error("Public key expected");
    if (tag && tag !== match[1])
        throw new Error(`Expected ${tag} but got ${match[1]}`);
    return Uint8Array.from(atob(match[2]), (b) => b.codePointAt(0) as number);
}

export function publicStringToDER(s: string) {
    if (s.startsWith("PUB_")) {
        return publicKeyPairToDER(publicStringToKeyPair(s));
    } else {
        return PEMtoDER(s, "PUBLIC KEY");
    }
}

function getSPKIPrefix(keyType: 0 | 1) {
    if (keyType == 0) {
        return "3036301006072a8648ce3d020106052b8104000a032200";
    } else if (keyType == 1) {
        return "3039301306072a8648ce3d020106082a8648ce3d030107032200";
    }
    throw new Error("unsupported key type");
}

export function publicKeyPairToDER({ keyType, keyPair }: any): Uint8Array {
    const prefix = getSPKIPrefix(keyType);

    const l = prefix.length / 2;
    const result = new Uint8Array(l + 33);
    let i = 0;
    for (; i < l; ++i) {
        result[i] = parseInt(prefix.substring(i * 2, i * 2 + 2), 16);
    }
    const x = keyPair.getPublic().getX().toArray("be", 32);
    const y = keyPair.getPublic().getY().toArray("be", 32);
    result[i++] = y[31] & 1 ? 3 : 2;
    for (let j = 0; j < x.length; ++i, ++j) {
        result[i] = x[j];
    }
    return result;
}

// Convert the signature in {keyType, signature} to fracpack format
export function signatureToFracpack({ keyType, signature }: any): Uint8Array {
    const r = signature.r.toArray("be", 32);
    const s = signature.s.toArray("be", 32);
    return new Uint8Array(
        [
            4,
            0,
            0,
            0, // offset to variant
            keyType, // variant index
            64,
            0,
            0,
            0, // variant size
        ].concat(r, s)
    );
}

export function signatureToBin({ signature }: any) {
    const r = signature.r.toArray("be", 32);
    const s = signature.s.toArray("be", 32);
    return new Uint8Array(r.concat(s));
}

export function keyPairStrings(key: any): any {
    return {
        pub: publicKeyPairToString(key),
        priv: privateKeyPairToString(key),
    };
}

export function genKeyPair(keyType: any): any {
    let keypair = { keyType, keyPair: getK1().genKeyPair() };

    return keyPairStrings(keypair);
}
