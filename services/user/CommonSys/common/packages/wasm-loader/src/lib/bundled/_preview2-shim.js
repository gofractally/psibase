var e = (e, t, s) => {
        if (!t.has(e)) throw TypeError("Cannot " + s);
    },
    t = (t, s, n) => (
        e(t, s, "read from private field"), n ? n.call(t) : s.get(t)
    ),
    s = (e, t, s) => {
        if (t.has(e))
            throw TypeError(
                "Cannot add the same private member more than once",
            );
        t instanceof WeakSet ? t.add(e) : t.set(e, s);
    },
    n = (t, s, n, r) => (
        e(t, s, "write to private field"), r ? r.call(t, n) : s.set(t, n), n
    );
const r = {
        resolution: () => 1e6,
        now: () => BigInt(Math.floor(1e6 * performance.now())),
        subscribeInstant(e) {
            e = BigInt(e);
            const t = this.now();
            return e <= t
                ? this.subscribeDuration(0)
                : this.subscribeDuration(e - t);
        },
        subscribeDuration(e) {
            (e = BigInt(e)), console.log("[monotonic-clock] subscribe");
        },
    },
    i = {
        now() {
            let e = Date.now();
            return {
                seconds: BigInt(Math.floor(e / 1e3)),
                nanoseconds: (e % 1e3) * 1e6,
            };
        },
        resolution: () => ({ seconds: 0n, nanoseconds: 1e6 }),
    };
let o = 0;
const a = Symbol.dispose || Symbol.for("dispose"),
    l = {
        Error: class {
            constructor(e) {
                this.msg = e;
            }
            toDebugString() {
                return this.msg;
            }
        },
    },
    c = {
        InputStream: class {
            constructor(e) {
                e || console.trace("no handler"),
                    (this.id = ++o),
                    (this.handler = e);
            }
            read(e) {
                return this.handler.read
                    ? this.handler.read(e)
                    : this.handler.blockingRead.call(this, e);
            }
            blockingRead(e) {
                return this.handler.blockingRead.call(this, e);
            }
            skip(e) {
                if (this.handler.skip) return this.handler.skip.call(this, e);
                if (this.handler.read) {
                    const t = this.handler.read.call(this, e);
                    return BigInt(t.byteLength);
                }
                return this.blockingSkip.call(this, e);
            }
            blockingSkip(e) {
                if (this.handler.blockingSkip)
                    return this.handler.blockingSkip.call(this, e);
                const t = this.handler.blockingRead.call(this, e);
                return BigInt(t.byteLength);
            }
            subscribe() {
                console.log(`[streams] Subscribe to input stream ${this.id}`);
            }
            [a]() {
                this.handler.drop && this.handler.drop.call(this);
            }
        },
        OutputStream: class {
            constructor(e) {
                e || console.trace("no handler"),
                    (this.id = ++o),
                    (this.open = !0),
                    (this.handler = e);
            }
            checkWrite(e) {
                return this.open
                    ? this.handler.checkWrite
                        ? this.handler.checkWrite.call(this, e)
                        : 1000000n
                    : 0n;
            }
            write(e) {
                this.handler.write.call(this, e);
            }
            blockingWriteAndFlush(e) {
                this.handler.write.call(this, e);
            }
            flush() {
                this.handler.flush && this.handler.flush.call(this);
            }
            blockingFlush() {
                this.open = !0;
            }
            writeZeroes(e) {
                this.write.call(this, new Uint8Array(Number(e)));
            }
            blockingWriteZeroes(e) {
                this.blockingWrite.call(this, new Uint8Array(Number(e)));
            }
            blockingWriteZeroesAndFlush(e) {
                this.blockingWriteAndFlush.call(
                    this,
                    new Uint8Array(Number(e)),
                );
            }
            splice(e, t) {
                const s = Math.min(t, this.checkWrite.call(this)),
                    n = e.read(s);
                return this.write.call(this, n), n.byteLength;
            }
            blockingSplice(e, t) {
                console.log(`[streams] Blocking splice ${this.id}`);
            }
            forward(e) {
                console.log(`[streams] Forward ${this.id}`);
            }
            subscribe() {
                console.log(`[streams] Subscribe to output stream ${this.id}`);
            }
            [a]() {}
        },
    },
    d = {
        Pollable: class {},
        pollList: function (e) {},
        pollOne: function (e) {},
    },
    { InputStream: u, OutputStream: h } = c,
    g = Symbol.dispose ?? Symbol.for("dispose");
let m = [],
    p = [];
function y(e) {
    m = Object.entries(e);
}
function f(e) {
    p = e;
}
const b = {
    getEnvironment: () => m,
    getArguments: () => p,
    initialCwd: () => null,
};
class w extends Error {
    constructor(e) {
        super("Component exited " + (e ? "successfully" : "with error")),
            (this.exitError = !0),
            (this.ok = e);
    }
}
const S = {
    exit(e) {
        throw new w("err" === e.tag);
    },
};
function k(e) {
    I.handler = e;
}
function A(e) {
    E.handler = e;
}
function B(e) {
    R.handler = e;
}
const I = new u({ blockingRead(e) {}, subscribe() {}, [g]() {} });
let T = new TextDecoder();
const R = new h({
        write(e) {
            console.log(T.decode(e));
        },
        blockingFlush() {},
        [g]() {},
    }),
    E = new h({
        write(e) {
            console.error(T.decode(e));
        },
        blockingFlush() {},
        [g]() {},
    }),
    v = { InputStream: u, getStdin: () => I },
    L = { OutputStream: h, getStdout: () => R },
    N = { OutputStream: h, getStderr: () => E };
class D {}
class U {}
const O = new U(),
    x = new U(),
    F = new D(),
    C = { TerminalInput: D },
    M = { TerminalOutput: U },
    W = { TerminalOutput: U, getTerminalStderr: () => x },
    z = { TerminalInput: D, getTerminalStdin: () => F },
    H = { TerminalOutput: U, getTerminalStdout: () => O },
    { InputStream: _, OutputStream: V } = c;
let K = null;
function $(e) {
    var t;
    (Z = e), (ne[0] = new ee(e)), (t = b.initialCwd() || "/"), (K = t);
}
function j() {
    return JSON.stringify(Z);
}
let Z = { dir: {} };
const P = { seconds: BigInt(0), nanoseconds: 0 };
function Y(e, t, s) {
    "." === t &&
        ne &&
        te(ne[0]) === e &&
        (t = K).startsWith("/") &&
        "/" !== t &&
        (t = t.slice(1));
    let n,
        r = e;
    do {
        if (!r || !r.dir) throw "not-directory";
        n = t.indexOf("/");
        const e = -1 === n ? t : t.slice(0, n);
        if (".." === e) throw "no-entry";
        "." === e ||
            "" === e ||
            (r =
                !r.dir[e] && s.create
                    ? (r.dir[e] = s.directory
                          ? { dir: {} }
                          : { source: new Uint8Array([]) })
                    : r.dir[e]),
            (t = t.slice(n + 1));
    } while (-1 !== n);
    if (!r) throw "no-entry";
    return r;
}
function q(e) {
    return (
        "string" == typeof e.source &&
            (e.source = new TextEncoder().encode(e.source)),
        e.source
    );
}
class G {
    constructor(e) {
        (this.idx = 0), (this.entries = e);
    }
    readDirectoryEntry() {
        if (this.idx === this.entries.length) return null;
        const [e, t] = this.entries[this.idx];
        return (
            (this.idx += 1),
            { name: e, type: t.dir ? "directory" : "regular-file" }
        );
    }
}
var J, X, Q;
(J = new WeakMap()), (X = new WeakMap()), (Q = new WeakMap());
let ee = class e {
    constructor(e, t) {
        s(this, J, void 0),
            s(this, X, void 0),
            s(this, Q, 0),
            n(this, t ? J : X, e);
    }
    _getEntry(e) {
        return t(e, X);
    }
    readViaStream(e) {
        const s = q(t(this, X));
        let n = Number(e);
        return new _({
            blockingRead(e) {
                if (n === s.byteLength) throw { tag: "closed" };
                const t = s.slice(n, n + Number(e));
                return (n += t.byteLength), t;
            },
        });
    }
    writeViaStream(e) {
        const s = t(this, X);
        let n = Number(e);
        return new V({
            write(e) {
                const t = new Uint8Array(e.byteLength + s.source.byteLength);
                return (
                    t.set(s.source, 0),
                    t.set(e, n),
                    (n += e.byteLength),
                    (s.source = t),
                    e.byteLength
                );
            },
        });
    }
    appendViaStream() {
        console.log("[filesystem] APPEND STREAM");
    }
    advise(e, t, s, n) {
        console.log("[filesystem] ADVISE", e, t, s, n);
    }
    syncData() {
        console.log("[filesystem] SYNC DATA");
    }
    getFlags() {
        console.log("[filesystem] FLAGS FOR");
    }
    getType() {
        return t(this, J)
            ? "fifo"
            : t(this, X).dir
              ? "directory"
              : t(this, X).source
                ? "regular-file"
                : "unknown";
    }
    setSize(e) {
        console.log("[filesystem] SET SIZE", e);
    }
    setTimes(e, t) {
        console.log("[filesystem] SET TIMES", e, t);
    }
    read(e, s) {
        const n = q(t(this, X));
        return [n.slice(s, s + e), s + e >= n.byteLength];
    }
    write(e, s) {
        if (0 !== s) throw "invalid-seek";
        return (t(this, X).source = e), e.byteLength;
    }
    readDirectory() {
        var e;
        if (null == (e = t(this, X)) || !e.dir) throw "bad-descriptor";
        return new G(
            Object.entries(t(this, X).dir).sort(([e], [t]) => (e > t ? 1 : -1)),
        );
    }
    sync() {
        console.log("[filesystem] SYNC");
    }
    createDirectoryAt(e) {
        if (Y(t(this, X), e, { create: !0, directory: !0 }).source)
            throw "exist";
    }
    stat() {
        let e = "unknown",
            s = BigInt(0);
        if (t(this, X).source) {
            e = "regular-file";
            const n = q(t(this, X));
            s = BigInt(n.byteLength);
        } else t(this, X).dir && (e = "directory");
        return {
            type: e,
            linkCount: BigInt(0),
            size: s,
            dataAccessTimestamp: P,
            dataModificationTimestamp: P,
            statusChangeTimestamp: P,
        };
    }
    statAt(e, s) {
        const n = Y(t(this, X), s);
        let r = "unknown",
            i = BigInt(0);
        if (n.source) {
            r = "regular-file";
            const e = q(n);
            i = BigInt(e.byteLength);
        } else n.dir && (r = "directory");
        return {
            type: r,
            linkCount: BigInt(0),
            size: i,
            dataAccessTimestamp: P,
            dataModificationTimestamp: P,
            statusChangeTimestamp: P,
        };
    }
    setTimesAt() {
        console.log("[filesystem] SET TIMES AT");
    }
    linkAt() {
        console.log("[filesystem] LINK AT");
    }
    openAt(s, n, r, i, o) {
        const a = Y(t(this, X), n, r);
        return new e(a);
    }
    readlinkAt() {
        console.log("[filesystem] READLINK AT");
    }
    removeDirectoryAt() {
        console.log("[filesystem] REMOVE DIR AT");
    }
    renameAt() {
        console.log("[filesystem] RENAME AT");
    }
    symlinkAt() {
        console.log("[filesystem] SYMLINK AT");
    }
    unlinkFileAt() {
        console.log("[filesystem] UNLINK FILE AT");
    }
    isSameObject(e) {
        return e === this;
    }
    metadataHash() {
        let e = BigInt(0);
        return (e += BigInt(t(this, Q))), { upper: e, lower: BigInt(0) };
    }
    metadataHashAt(e, s) {
        let n = BigInt(0);
        return (n += BigInt(t(this, Q))), { upper: n, lower: BigInt(0) };
    }
};
const te = ee.prototype._getEntry;
delete ee.prototype._getEntry;
let se = [[new ee(Z), "/"]],
    ne = se[0];
const re = { getDirectories: () => se },
    ie = { Descriptor: ee, DirectoryEntryStream: G };
function oe(e) {
    console.log(`[http] Send (browser) ${e.uri}`);
    try {
        const t = new XMLHttpRequest();
        t.open(e.method.toString(), e.uri, !1);
        const s = new Headers(e.headers);
        for (let [e, n] of s.entries())
            "user-agent" !== e && "host" !== e && t.setRequestHeader(e, n);
        t.send(e.body && e.body.length > 0 ? e.body : null);
        const n = t.response ? new TextEncoder().encode(t.response) : void 0,
            r = [];
        return (
            t
                .getAllResponseHeaders()
                .trim()
                .split(/[\r\n]+/)
                .forEach((e) => {
                    var t = e.split(": "),
                        s = t.shift(),
                        n = t.join(": ");
                    r.push([s, n]);
                }),
            { status: t.status, headers: r, body: n }
        );
    } catch (e) {
        throw new Error(e.message);
    }
}
const ae = { handle() {} },
    le = { handle() {} },
    ce = 65536;
let de, ue;
const he = {
    getInsecureRandomBytes: (e) => ye.getRandomBytes(e),
    getInsecureRandomU64: () => ye.getRandomU64(),
};
let ge, me;
const pe = {
        insecureSeed: () => (
            void 0 === ge &&
                ((ge = ye.getRandomU64()), (me = ye.getRandomU64())),
            [ge, me]
        ),
    },
    ye = {
        getRandomBytes(e) {
            const t = new Uint8Array(Number(e));
            if (e > ce)
                for (var s = 0; s < e; s += ce)
                    crypto.getRandomValues(t.subarray(s, s + ce));
            else crypto.getRandomValues(t);
            return t;
        },
        getRandomU64: () => crypto.getRandomValues(new BigUint64Array(1))[0],
        insecureRandom: () => (
            void 0 === de &&
                ((de = ye.getRandomU64()), (ue = ye.getRandomU64())),
            [de, ue]
        ),
    },
    fe = {
        instanceNetwork() {
            console.log("[sockets] instance network");
        },
    },
    be = {
        dropResolveAddressStream() {},
        subscribe() {},
        resolveAddresses() {},
        resolveNextAddress() {},
        nonBlocking() {},
        setNonBlocking() {},
    },
    we = { dropNetwork() {} },
    Se = { createTcpSocket() {} },
    ke = {
        subscribe() {},
        dropTcpSocket() {},
        bind() {},
        connect() {},
        listen() {},
        accept() {},
        localAddress() {},
        remoteAddress() {},
        addressFamily() {},
        setListenBacklogSize() {},
        keepAlive() {},
        setKeepAlive() {},
        noDelay() {},
        setNoDelay() {},
        unicastHopLimit() {},
        setUnicastHopLimit() {},
        receiveBufferSize() {},
        setReceiveBufferSize() {},
        sendBufferSize() {},
        setSendBufferSize() {},
        nonBlocking() {},
        setNonBlocking() {},
        shutdown() {},
    },
    Ae = {
        subscribe() {},
        dropUdpSocket() {},
        bind() {},
        connect() {},
        receive() {},
        send() {},
        localAddress() {},
        remoteAddress() {},
        addressFamily() {},
        unicastHopLimit() {},
        setUnicastHopLimit() {},
        receiveBufferSize() {},
        setReceiveBufferSize() {},
        sendBufferSize() {},
        setSendBufferSize() {},
        nonBlocking() {},
        setNonBlocking() {},
    },
    Be = { createUdpSocket() {} };
export {
    j as _getFileData,
    f as _setArgs,
    y as _setEnv,
    $ as _setFileData,
    A as _setStderr,
    k as _setStdin,
    B as _setStdout,
    b as environment,
    l as error,
    S as exit,
    ie as filesystemTypes,
    ae as incomingHandler,
    he as insecure,
    pe as insecureSeed,
    fe as instanceNetwork,
    be as ipNameLookup,
    r as monotonicClock,
    we as network,
    le as outgoingHandler,
    d as poll,
    re as preopens,
    ye as random,
    oe as send,
    N as stderr,
    v as stdin,
    L as stdout,
    c as streams,
    ke as tcp,
    Se as tcpCreateSocket,
    C as terminalInput,
    M as terminalOutput,
    W as terminalStderr,
    z as terminalStdin,
    H as terminalStdout,
    ie as types,
    Ae as udp,
    Be as udpCreateSocket,
    i as wallClock,
};
