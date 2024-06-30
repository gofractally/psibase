declare function j(): string;
declare function f(e: any): void;
declare function y(e: any): void;
declare function $(e: any): void;
declare function A(e: any): void;
declare function k(e: any): void;
declare function B(e: any): void;
declare namespace b {
    function getEnvironment(): any[];
    function getArguments(): any[];
    function initialCwd(): null;
}
declare namespace l {
    export { Error };
}
declare namespace S {
    function exit(e: any): never;
}
declare namespace ie {
    export { ee as Descriptor };
    export { G as DirectoryEntryStream };
}
declare namespace ae {
    function handle(): void;
}
declare namespace he {
    function getInsecureRandomBytes(e: any): Uint8Array;
    function getInsecureRandomU64(): bigint;
}
declare namespace pe {
    function insecureSeed(): any[];
}
declare namespace fe {
    function instanceNetwork(): void;
}
declare namespace be {
    function dropResolveAddressStream(): void;
    function subscribe(): void;
    function resolveAddresses(): void;
    function resolveNextAddress(): void;
    function nonBlocking(): void;
    function setNonBlocking(): void;
}
declare namespace r {
    function resolution(): number;
    function now(): bigint;
    function subscribeInstant(e: any): void;
    function subscribeDuration(e: any): void;
}
declare namespace we {
    function dropNetwork(): void;
}
declare namespace le {
    function handle(): void;
}
declare namespace d {
    export { Pollable };
    export function pollList(e: any): void;
    export function pollOne(e: any): void;
}
declare namespace re {
    function getDirectories(): (
        | string
        | {
              _getEntry(e: any): any;
              readViaStream(e: any): {
                  id: number;
                  handler: any;
                  read(e: any): any;
                  blockingRead(e: any): any;
                  skip(e: any): any;
                  blockingSkip(e: any): any;
                  subscribe(): void;
              };
              writeViaStream(e: any): {
                  id: number;
                  open: boolean;
                  handler: any;
                  checkWrite(e: any): any;
                  write(e: any): void;
                  blockingWriteAndFlush(e: any): void;
                  flush(): void;
                  blockingFlush(): void;
                  writeZeroes(e: any): void;
                  blockingWriteZeroes(e: any): void;
                  blockingWriteZeroesAndFlush(e: any): void;
                  splice(e: any, t: any): any;
                  blockingSplice(e: any, t: any): void;
                  forward(e: any): void;
                  subscribe(): void;
              };
              appendViaStream(): void;
              advise(e: any, t: any, s: any, n: any): void;
              syncData(): void;
              getFlags(): void;
              getType(): "directory" | "regular-file" | "fifo" | "unknown";
              setSize(e: any): void;
              setTimes(e: any, t: any): void;
              read(e: any, s: any): any[];
              write(e: any, s: any): any;
              readDirectory(): G;
              sync(): void;
              createDirectoryAt(e: any): void;
              stat(): {
                  type: string;
                  linkCount: bigint;
                  size: bigint;
                  dataAccessTimestamp: {
                      seconds: bigint;
                      nanoseconds: number;
                  };
                  dataModificationTimestamp: {
                      seconds: bigint;
                      nanoseconds: number;
                  };
                  statusChangeTimestamp: {
                      seconds: bigint;
                      nanoseconds: number;
                  };
              };
              statAt(
                  e: any,
                  s: any,
              ): {
                  type: string;
                  linkCount: bigint;
                  size: bigint;
                  dataAccessTimestamp: {
                      seconds: bigint;
                      nanoseconds: number;
                  };
                  dataModificationTimestamp: {
                      seconds: bigint;
                      nanoseconds: number;
                  };
                  statusChangeTimestamp: {
                      seconds: bigint;
                      nanoseconds: number;
                  };
              };
              setTimesAt(): void;
              linkAt(): void;
              openAt(s: any, n: any, r: any, i: any, o: any): any;
              readlinkAt(): void;
              removeDirectoryAt(): void;
              renameAt(): void;
              symlinkAt(): void;
              unlinkFileAt(): void;
              isSameObject(e: any): boolean;
              metadataHash(): {
                  upper: bigint;
                  lower: bigint;
              };
              metadataHashAt(
                  e: any,
                  s: any,
              ): {
                  upper: bigint;
                  lower: bigint;
              };
          }
    )[][];
}
declare namespace ye {
    function getRandomBytes(e: any): Uint8Array;
    function getRandomU64(): bigint;
    function insecureRandom(): any[];
}
declare function oe(e: any): {
    status: number;
    headers: any[];
    body: Uint8Array | undefined;
};
declare namespace N {
    export { h as OutputStream };
    export function getStderr(): {
        id: number;
        open: boolean;
        handler: any;
        checkWrite(e: any): any;
        write(e: any): void;
        blockingWriteAndFlush(e: any): void;
        flush(): void;
        blockingFlush(): void;
        writeZeroes(e: any): void;
        blockingWriteZeroes(e: any): void;
        blockingWriteZeroesAndFlush(e: any): void;
        splice(e: any, t: any): any;
        blockingSplice(e: any, t: any): void;
        forward(e: any): void;
        subscribe(): void;
    };
}
declare namespace v {
    export { u as InputStream };
    export function getStdin(): {
        id: number;
        handler: any;
        read(e: any): any;
        blockingRead(e: any): any;
        skip(e: any): any;
        blockingSkip(e: any): any;
        subscribe(): void;
    };
}
declare namespace L {
    export { h as OutputStream };
    export function getStdout(): {
        id: number;
        open: boolean;
        handler: any;
        checkWrite(e: any): any;
        write(e: any): void;
        blockingWriteAndFlush(e: any): void;
        flush(): void;
        blockingFlush(): void;
        writeZeroes(e: any): void;
        blockingWriteZeroes(e: any): void;
        blockingWriteZeroesAndFlush(e: any): void;
        splice(e: any, t: any): any;
        blockingSplice(e: any, t: any): void;
        forward(e: any): void;
        subscribe(): void;
    };
}
declare namespace c {
    export { InputStream };
    export { OutputStream };
}
declare namespace ke {
    function subscribe(): void;
    function dropTcpSocket(): void;
    function bind(): void;
    function connect(): void;
    function listen(): void;
    function accept(): void;
    function localAddress(): void;
    function remoteAddress(): void;
    function addressFamily(): void;
    function setListenBacklogSize(): void;
    function keepAlive(): void;
    function setKeepAlive(): void;
    function noDelay(): void;
    function setNoDelay(): void;
    function unicastHopLimit(): void;
    function setUnicastHopLimit(): void;
    function receiveBufferSize(): void;
    function setReceiveBufferSize(): void;
    function sendBufferSize(): void;
    function setSendBufferSize(): void;
    function nonBlocking(): void;
    function setNonBlocking(): void;
    function shutdown(): void;
}
declare namespace Se {
    function createTcpSocket(): void;
}
declare namespace C {
    export { D as TerminalInput };
}
declare namespace M {
    export { U as TerminalOutput };
}
declare namespace W {
    export { U as TerminalOutput };
    export function getTerminalStderr(): U;
}
declare namespace z {
    export { D as TerminalInput };
    export function getTerminalStdin(): D;
}
declare namespace H {
    export { U as TerminalOutput };
    export function getTerminalStdout(): U;
}
declare namespace Ae {
    function subscribe(): void;
    function dropUdpSocket(): void;
    function bind(): void;
    function connect(): void;
    function receive(): void;
    function send(): void;
    function localAddress(): void;
    function remoteAddress(): void;
    function addressFamily(): void;
    function unicastHopLimit(): void;
    function setUnicastHopLimit(): void;
    function receiveBufferSize(): void;
    function setReceiveBufferSize(): void;
    function sendBufferSize(): void;
    function setSendBufferSize(): void;
    function nonBlocking(): void;
    function setNonBlocking(): void;
}
declare namespace Be {
    function createUdpSocket(): void;
}
declare namespace i {
    export function now(): {
        seconds: bigint;
        nanoseconds: number;
    };
    export function resolution_1(): {
        seconds: bigint;
        nanoseconds: number;
    };
    export { resolution_1 as resolution };
}
declare class Error {
    constructor(e: any);
    msg: any;
    toDebugString(): any;
}
declare let ee: {
    new (
        e: any,
        t: any,
    ): {
        _getEntry(e: any): any;
        readViaStream(e: any): {
            id: number;
            handler: any;
            read(e: any): any;
            blockingRead(e: any): any;
            skip(e: any): any;
            blockingSkip(e: any): any;
            subscribe(): void;
        };
        writeViaStream(e: any): {
            id: number;
            open: boolean;
            handler: any;
            checkWrite(e: any): any;
            write(e: any): void;
            blockingWriteAndFlush(e: any): void;
            flush(): void;
            blockingFlush(): void;
            writeZeroes(e: any): void;
            blockingWriteZeroes(e: any): void;
            blockingWriteZeroesAndFlush(e: any): void;
            splice(e: any, t: any): any;
            blockingSplice(e: any, t: any): void;
            forward(e: any): void;
            subscribe(): void;
        };
        appendViaStream(): void;
        advise(e: any, t: any, s: any, n: any): void;
        syncData(): void;
        getFlags(): void;
        getType(): "directory" | "regular-file" | "fifo" | "unknown";
        setSize(e: any): void;
        setTimes(e: any, t: any): void;
        read(e: any, s: any): any[];
        write(e: any, s: any): any;
        readDirectory(): G;
        sync(): void;
        createDirectoryAt(e: any): void;
        stat(): {
            type: string;
            linkCount: bigint;
            size: bigint;
            dataAccessTimestamp: {
                seconds: bigint;
                nanoseconds: number;
            };
            dataModificationTimestamp: {
                seconds: bigint;
                nanoseconds: number;
            };
            statusChangeTimestamp: {
                seconds: bigint;
                nanoseconds: number;
            };
        };
        statAt(
            e: any,
            s: any,
        ): {
            type: string;
            linkCount: bigint;
            size: bigint;
            dataAccessTimestamp: {
                seconds: bigint;
                nanoseconds: number;
            };
            dataModificationTimestamp: {
                seconds: bigint;
                nanoseconds: number;
            };
            statusChangeTimestamp: {
                seconds: bigint;
                nanoseconds: number;
            };
        };
        setTimesAt(): void;
        linkAt(): void;
        openAt(s: any, n: any, r: any, i: any, o: any): any;
        readlinkAt(): void;
        removeDirectoryAt(): void;
        renameAt(): void;
        symlinkAt(): void;
        unlinkFileAt(): void;
        isSameObject(e: any): boolean;
        metadataHash(): {
            upper: bigint;
            lower: bigint;
        };
        metadataHashAt(
            e: any,
            s: any,
        ): {
            upper: bigint;
            lower: bigint;
        };
    };
};
declare class G {
    constructor(e: any);
    idx: number;
    entries: any;
    readDirectoryEntry(): {
        name: any;
        type: string;
    } | null;
}
declare class Pollable {}
declare const h: {
    new (e: any): {
        id: number;
        open: boolean;
        handler: any;
        checkWrite(e: any): any;
        write(e: any): void;
        blockingWriteAndFlush(e: any): void;
        flush(): void;
        blockingFlush(): void;
        writeZeroes(e: any): void;
        blockingWriteZeroes(e: any): void;
        blockingWriteZeroesAndFlush(e: any): void;
        splice(e: any, t: any): any;
        blockingSplice(e: any, t: any): void;
        forward(e: any): void;
        subscribe(): void;
    };
};
declare const u: {
    new (e: any): {
        id: number;
        handler: any;
        read(e: any): any;
        blockingRead(e: any): any;
        skip(e: any): any;
        blockingSkip(e: any): any;
        subscribe(): void;
    };
};
declare class InputStream {
    constructor(e: any);
    id: number;
    handler: any;
    read(e: any): any;
    blockingRead(e: any): any;
    skip(e: any): any;
    blockingSkip(e: any): any;
    subscribe(): void;
}
declare class OutputStream {
    constructor(e: any);
    id: number;
    open: boolean;
    handler: any;
    checkWrite(e: any): any;
    write(e: any): void;
    blockingWriteAndFlush(e: any): void;
    flush(): void;
    blockingFlush(): void;
    writeZeroes(e: any): void;
    blockingWriteZeroes(e: any): void;
    blockingWriteZeroesAndFlush(e: any): void;
    splice(e: any, t: any): any;
    blockingSplice(e: any, t: any): void;
    forward(e: any): void;
    subscribe(): void;
}
declare class D {}
declare class U {}
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
