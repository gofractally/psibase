import elliptic from 'https://cdn.skypack.dev/elliptic';
import hashJs from 'https://cdn.skypack.dev/hash.js';

// Key type
export const KeyType = {
    k1: 0,
    r1: 1,
};

const publicKeyDataSize = 33;
const privateKeyDataSize = 32;
const signatureDataSize = 64;

const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function create_base58_map() {
    const base58M = Array(256).fill(-1);
    for (let i = 0; i < base58Chars.length; ++i) {
        base58M[base58Chars.charCodeAt(i)] = i;
    }
    return base58M;
};

const base58Map = create_base58_map();

function base58ToBinary(size, s) {
    const result = new Uint8Array(size);
    for (let i = 0; i < s.length; ++i) {
        let carry = base58Map[s.charCodeAt(i)];
        if (carry < 0) {
            throw new Error('invalid base-58 value');
        }
        for (let j = 0; j < size; ++j) {
            const x = result[j] * 58 + carry;
            result[j] = x;
            carry = x >> 8;
        }
        if (carry) {
            throw new Error('base-58 value is out of range');
        }
    }
    result.reverse();
    return result;
};

function binaryToBase58(bignum) {
    const result = [];
    for (const byte of bignum) {
        let carry = byte;
        for (let j = 0; j < result.length; ++j) {
            const x = (base58Map[result[j]] << 8) + carry;
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
            result.push('1'.charCodeAt(0));
        }
    }
    result.reverse();
    return String.fromCharCode(...result);
};

function digestSuffixRipemd160(data, suffix) {
    const d = [];
    for (let i = 0; i < data.length; ++i) {
        d[i] = data[i];
    }
    for (let i = 0; i < suffix.length; ++i) {
        d[data.length + i] = suffix.charCodeAt(i);
    }
    return new hashJs.ripemd160().update(d).digest();
};

function stringToKey(s, size, suffix) {
    const whole = base58ToBinary(size ? size + 4 : 0, s);
    const result = new Uint8Array(whole.buffer, 0, whole.length - 4);
    const digest = digestSuffixRipemd160(result, suffix);
    if (digest[0] !== whole[whole.length - 4] || digest[1] !== whole[whole.length - 3]
        || digest[2] !== whole[whole.length - 2] || digest[3] !== whole[whole.length - 1]) {
        throw new Error('checksum doesn\'t match');
    }
    return result;
};

function keyToString(data, suffix, prefix) {
    const digest = digestSuffixRipemd160(data, suffix);
    const whole = new Uint8Array(data.length + 4);
    for (let i = 0; i < data.length; ++i) {
        whole[i] = data[i];
    }
    for (let i = 0; i < 4; ++i) {
        whole[i + data.length] = digest[i];
    }
    return prefix + binaryToBase58(whole);
};

let k1;
function getK1() {
    if (!k1)
        k1 = new elliptic.ec('secp256k1');
    return k1;
}

let r1;
function getR1() {
    if (!r1)
        r1 = new elliptic.ec('p256');
    return r1;
}

// Convert a private key in string form to {keyType, keyPair}
export function privateStringToKeyPair(s) {
    let keyType, data, ec;
    if (s.substr(0, 7) === 'PVT_K1_')
        [keyType, data, ec] = [KeyType.k1, stringToKey(s.substr(7), privateKeyDataSize, 'K1'), getK1()];
    else if (s.substr(0, 7) === 'PVT_R1_')
        [keyType, data, ec] = [KeyType.r1, stringToKey(s.substr(7), privateKeyDataSize, 'R1'), getR1()];
    else
        throw new Error('unsupported key type');
    return { keyType, keyPair: ec.keyFromPrivate(data) };
}

// Convert a public key in string form to {keyType, keyPair}
export function publicStringToKeyPair(s) {
    let keyType, data, ec;
    if (s.substr(0, 7) === 'PUB_K1_')
        [keyType, data, ec] = [KeyType.k1, stringToKey(s.substr(7), publicKeyDataSize, 'K1'), getK1()];
    else if (s.substr(0, 7) === 'PUB_R1_')
        [keyType, data, ec] = [KeyType.r1, stringToKey(s.substr(7), publicKeyDataSize, 'R1'), getR1()];
    else
        throw new Error('unsupported key type');
    return { keyType, keyPair: ec.keyPair({ pub: data }) };
}

// Convert the private key in {keyType, keyPair} to a string
export function privateKeyPairToString({ keyType, keyPair }) {
    const data = keyPair.getPrivate().toArrayLike(Uint8Array, 'be', 32);
    if (keyType === KeyType.k1)
        return keyToString(data, 'K1', 'PVT_K1_');
    else if (keyType === KeyType.r1)
        return keyToString(data, 'R1', 'PVT_R1_');
    else
        throw new Error('unsupported key type');
}

// Convert the public key in {keyType, keyPair} to a string
export function publicKeyPairToString({ keyType, keyPair }) {
    const x = keyPair.getPublic().getX().toArray('be', 32);
    const y = keyPair.getPublic().getY().toArray('be', 32);
    const data = [(y[31] & 1) ? 3 : 2].concat(x);
    if (keyType === KeyType.k1)
        return keyToString(data, 'K1', 'PUB_K1_');
    else if (keyType === KeyType.r1)
        return keyToString(data, 'R1', 'PUB_R1_');
    else
        throw new Error('unsupported key type');
}

// Convert the public key in {keyType, keyPair} to fracpack format
export function publicKeyPairToFracpack({ keyType, keyPair }) {
    const x = keyPair.getPublic().getX().toArray('be', 32);
    const y = keyPair.getPublic().getY().toArray('be', 32);
    return new Uint8Array([
        4, 0, 0, 0,         // offset to variant
        keyType,            // variant index
        33, 0, 0, 0,        // variant size
        (y[31] & 1) ? 3 : 2 // inner array begins here
    ].concat(x));
}

// Convert the signature in {keyType, signature} to fracpack format
export function signatureToFracpack({ keyType, signature }) {
    const r = signature.r.toArray('be', 32);
    const s = signature.s.toArray('be', 32);
    return new Uint8Array([
        4, 0, 0, 0,         // offset to variant
        keyType,            // variant index
        64, 0, 0, 0,        // variant size
    ].concat(r, s));
}

export function keyPairStrings(key)
{
    return {
        pub: publicKeyPairToString(key),
        priv: privateKeyPairToString(key),
    };
}

export function genKeyPair(keyType) {
    let keypair = { keyType, keyPair: getK1().genKeyPair() };

    return keyPairStrings(keypair);
}

// console.log(privateKeyPairToString(privateStringToKeyPair('PVT_R1_fJ6ASApAc9utAL4zfNE4qwo22p7JpgHHSCVJ9pQfw4vZPXCq3')));
// console.log(publicKeyPairToString(privateStringToKeyPair('PVT_R1_fJ6ASApAc9utAL4zfNE4qwo22p7JpgHHSCVJ9pQfw4vZPXCq3')));
// console.log(publicKeyPairToString(publicStringToKeyPair('PUB_R1_7pGpnu7HZVwi8kiLLDK2MJ6aYYS23eRJYmDXSLq5WZFCN6WEqY')));

// console.log(privateKeyPairToString(privateStringToKeyPair('PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V')));
// console.log(publicKeyPairToString(privateStringToKeyPair('PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V')));
// console.log(publicKeyPairToString(publicStringToKeyPair('PUB_K1_6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5BoDq63')));
