import hashJs from "hash.js";

import {
    ACTION_NAME_FORMAT_VERSION,
    ACTION_NAME_MODEL_SHA256,
    CHARACTER_CDFS,
    WORD_CDF,
    WORD_COSTS,
    WORD_SYMBOLS,
} from "./action-name-model.generated";

/** An exact unsigned 64-bit action/event/reflected-name identifier. */
export type ActionName = bigint & { readonly __actionName: unique symbol };

export { ACTION_NAME_FORMAT_VERSION, ACTION_NAME_MODEL_SHA256 };

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789_";
const payloadBits = 62n;
const payloadMask = (1n << payloadBits) - 1n;
const u64Max = (1n << 64n) - 1n;
const total = 32768;
const half = 0x80000000;
const quarter = 0x40000000;
const threeQuarters = 0xc0000000;
const maximumRange = 0xffffffff;
const maximumNameLength = 256;
const hashDomain = "psibase.action_name.v1\0";

function canonicalName(text: string): string {
    if (
        typeof text !== "string" ||
        text.length === 0 ||
        text.length > maximumNameLength
    ) {
        throw new TypeError(
            "action name must be an ASCII identifier of 1..256 characters",
        );
    }
    for (let i = 0; i < text.length; ++i) {
        const code = text.charCodeAt(i);
        if (
            !(
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                code === 95 ||
                (i > 0 && code >= 48 && code <= 57)
            )
        ) {
            throw new TypeError(
                "action name must be an ASCII identifier of 1..256 characters",
            );
        }
    }
    return text.toLowerCase();
}

function checkedU64(value: bigint): bigint {
    if (typeof value !== "bigint" || value < 0n || value > u64Max) {
        throw new TypeError("action name ID must be an unsigned 64-bit bigint");
    }
    return value;
}

function bitLength(value: bigint): number {
    return value === 0n ? 0 : value.toString(2).length;
}

function contextRow(previous: number, last: number): readonly number[] {
    return CHARACTER_CDFS[
        last < 0 ? 0 : previous < 0 ? last + 1 : 38 + previous * 37 + last
    ];
}

type TrieNode = { children: Map<string, TrieNode>; token?: number };
let wordTrie: TrieNode | undefined;
function getWordTrie(): TrieNode {
    if (!wordTrie) {
        wordTrie = { children: new Map() };
        for (let token = 1; token < WORD_SYMBOLS.length; ++token) {
            let node = wordTrie;
            for (const char of WORD_SYMBOLS[token]) {
                let child = node.children.get(char);
                if (!child) {
                    child = { children: new Map() };
                    node.children.set(char, child);
                }
                node = child;
            }
            node.token = token;
        }
    }
    return wordTrie;
}

type WordPath = { cost: number; tokens: number[] };

function pathLess(left: WordPath, right: WordPath): boolean {
    if (left.cost !== right.cost) return left.cost < right.cost;
    if (left.tokens.length !== right.tokens.length) {
        return left.tokens.length < right.tokens.length;
    }
    for (let i = 0; i < left.tokens.length; ++i) {
        if (left.tokens[i] !== right.tokens[i]) {
            return left.tokens[i] < right.tokens[i];
        }
    }
    return false;
}

function wordTokens(name: string): number[] {
    const paths: (WordPath | undefined)[] = new Array(name.length + 1);
    paths[0] = { cost: 0, tokens: [] };
    for (let begin = 0; begin < name.length; ++begin) {
        const previous = paths[begin];
        if (!previous) continue;
        let node: TrieNode | undefined = getWordTrie();
        for (let end = begin; end < name.length; ++end) {
            node = node.children.get(name[end]);
            if (!node) break;
            if (node.token !== undefined) {
                const proposal = {
                    cost: previous.cost + WORD_COSTS[node.token],
                    tokens: [...previous.tokens, node.token],
                };
                if (!paths[end + 1] || pathLess(proposal, paths[end + 1]!)) {
                    paths[end + 1] = proposal;
                }
            }
        }
    }
    const result = paths[name.length];
    if (!result)
        throw new Error("action-name dictionary does not cover its alphabet");
    return result.tokens;
}

type ArithmeticResult = { payload: bigint; length: number };

/** Number operations here are exact integers: state products are at most 2^47. */
function encodeArithmetic(
    tokens: number[],
    mode: number,
): ArithmeticResult | undefined {
    let low = 0;
    let high = maximumRange;
    let pending = 0;
    let previous = -1;
    let last = -1;
    const bits: number[] = [];
    const emit = (bit: number) => {
        bits.push(bit);
        while (pending > 0) {
            bits.push(1 - bit);
            --pending;
        }
    };
    for (const token of [...tokens, 0]) {
        const cdf = mode === 0 ? contextRow(previous, last) : WORD_CDF;
        const width = high - low + 1;
        const nextHigh = low + Math.floor((width * cdf[token + 1]) / total) - 1;
        low += Math.floor((width * cdf[token]) / total);
        high = nextHigh;
        while (true) {
            if (high < half) {
                emit(0);
            } else if (low >= half) {
                emit(1);
                low -= half;
                high -= half;
            } else if (low >= quarter && high < threeQuarters) {
                ++pending;
                low -= quarter;
                high -= quarter;
            } else {
                break;
            }
            low *= 2;
            high = high * 2 + 1;
        }
        // More emitted/pending bits cannot become a fitting code later.
        if (bits.length + pending > 62) return undefined;
        if (mode === 0 && token !== 0) {
            previous = last;
            last = token - 1;
        }
    }
    ++pending;
    emit(low < quarter ? 0 : 1);
    if (bits.length > 62) return undefined;
    let payload = 0n;
    for (const bit of bits) payload = payload * 2n + BigInt(bit);
    payload <<= BigInt(62 - bits.length);
    return payload === 0n ? undefined : { payload, length: bits.length };
}

function encodeReadable(name: string): bigint | undefined {
    const candidates: { length: number; mode: number; payload: bigint }[] = [];
    const characters = [...name].map((char) => alphabet.indexOf(char) + 1);
    for (const [mode, tokens] of [
        [0, characters],
        [1, wordTokens(name)],
    ] as const) {
        const result = encodeArithmetic(tokens, mode);
        if (result) candidates.push({ ...result, mode });
    }
    let literal = 0n;
    for (const char of name) {
        literal = literal * 37n + BigInt(alphabet.indexOf(char) + 1);
        if (literal > payloadMask) break;
    }
    if (literal > 0n && literal <= payloadMask) {
        candidates.push({
            length: bitLength(literal),
            mode: 2,
            payload: literal,
        });
    }
    if (candidates.length === 0) return undefined;
    candidates.sort(
        (a, b) =>
            a.length - b.length ||
            a.mode - b.mode ||
            (a.payload < b.payload ? -1 : a.payload > b.payload ? 1 : 0),
    );
    return (BigInt(candidates[0].mode) << payloadBits) | candidates[0].payload;
}

function decodeArithmetic(payload: bigint, mode: number): string {
    const encoded = payload << 1n;
    let position = 0;
    const take = () => {
        const bit =
            position < 63 ? Number((encoded >> BigInt(62 - position)) & 1n) : 0;
        ++position;
        return bit;
    };
    let low = 0;
    let high = maximumRange;
    let code = 0;
    let previous = -1;
    let last = -1;
    let result = "";
    for (let i = 0; i < 32; ++i) code = code * 2 + take();
    for (let count = 0; count <= maximumNameLength; ++count) {
        const cdf = mode === 0 ? contextRow(previous, last) : WORD_CDF;
        const width = high - low + 1;
        const scaled = Math.floor(((code - low + 1) * total - 1) / width);
        let begin = 0;
        let end = cdf.length;
        while (begin < end) {
            const middle = Math.floor((begin + end) / 2);
            if (cdf[middle] <= scaled) begin = middle + 1;
            else end = middle;
        }
        const token = begin - 1;
        const symbols = mode === 0 ? 38 : WORD_SYMBOLS.length;
        if (token < 0 || token >= symbols)
            throw new TypeError("invalid arithmetic action name");
        if (token === 0) return result;
        result += mode === 0 ? alphabet[token - 1] : WORD_SYMBOLS[token];
        if (result.length > maximumNameLength)
            throw new TypeError("decoded action name exceeds 256 characters");
        const nextHigh = low + Math.floor((width * cdf[token + 1]) / total) - 1;
        low += Math.floor((width * cdf[token]) / total);
        high = nextHigh;
        while (true) {
            if (high < half) {
                // Range already occupies the lower half.
            } else if (low >= half) {
                code -= half;
                low -= half;
                high -= half;
            } else if (low >= quarter && high < threeQuarters) {
                code -= quarter;
                low -= quarter;
                high -= quarter;
            } else {
                break;
            }
            low *= 2;
            high = high * 2 + 1;
            code = code * 2 + take();
        }
        if (mode === 0) {
            previous = last;
            last = token - 1;
        }
    }
    throw new TypeError("decoded action name has no bounded EOS");
}

/** Encode canonical text or an exact #<16 lowercase hex digits> hash literal. */
export function encodeActionName(text: string): ActionName {
    if (typeof text === "string" && text.startsWith("#")) {
        if (text.length !== 17 || !/^#[0-9a-f]{16}$/.test(text)) {
            throw new TypeError(
                "hash literal must be # followed by 16 lowercase hex digits",
            );
        }
        const value = BigInt(`0x${text.slice(1)}`);
        if (value >> payloadBits !== 3n)
            throw new TypeError("hash literal must have hash-mode tag 3");
        return value as ActionName;
    }
    const name = canonicalName(text);
    const readable = encodeReadable(name);
    if (readable !== undefined) return readable as ActionName;
    const bytes = [...hashDomain, ...name].map((char) => char.charCodeAt(0));
    const digest = hashJs.sha256().update(bytes).digest() as number[];
    let payload = 0n;
    for (let i = 0; i < 8; ++i) payload |= BigInt(digest[i]) << BigInt(8 * i);
    return ((3n << payloadBits) | (payload & payloadMask)) as ActionName;
}

/** Decode a canonical readable ID or an exact full-u64 hash literal. */
export function decodeActionName(value: bigint): string {
    checkedU64(value);
    const mode = Number(value >> payloadBits);
    if (mode === 3) return `#${value.toString(16).padStart(16, "0")}`;
    let payload = value & payloadMask;
    let name: string;
    if (mode === 2) {
        const chars: string[] = [];
        while (payload > 0n) {
            const remainder = Number((payload - 1n) % 37n);
            payload = (payload - 1n) / 37n;
            chars.push(alphabet[remainder]);
        }
        name = chars.reverse().join("");
    } else {
        name = decodeArithmetic(payload, mode);
    }
    if (canonicalName(name) !== name || encodeReadable(name) !== value) {
        throw new TypeError("noncanonical readable action-name ID");
    }
    return name;
}

/** Wrap an exact opaque u64; decodeActionName separately validates its format. */
export function actionNameFromRaw(value: bigint): ActionName {
    return checkedU64(value) as ActionName;
}

/** Serialize raw u64 identity exactly, including IDs above Number.MAX_SAFE_INTEGER. */
export function actionNameToJSON(value: ActionName): string {
    return checkedU64(value).toString(10);
}

/** Parse the canonical unsigned decimal string used for exact numeric JSON IDs. */
export function actionNameFromJSON(value: string): ActionName {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 20 ||
        (value.length > 1 && value[0] === "0") ||
        [...value].some((char) => char < "0" || char > "9")
    ) {
        throw new TypeError(
            "action name numeric JSON must be a canonical unsigned decimal string",
        );
    }
    return actionNameFromRaw(BigInt(value));
}
