var __accessCheck = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateGet = (obj, member, getter) => {
  __accessCheck(obj, member, "read from private field");
  return getter ? getter.call(obj) : member.get(obj);
};
var __privateAdd = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateSet = (obj, member, value, setter) => {
  __accessCheck(obj, member, "write to private field");
  setter ? setter.call(obj, value) : member.set(obj, value);
  return value;
};
var _stream, _entry, _mtime;
const monotonicClock = {
  resolution() {
    return 1e6;
  },
  now() {
    return BigInt(Math.floor(performance.now() * 1e6));
  },
  subscribeInstant(instant) {
    instant = BigInt(instant);
    const now = this.now();
    if (instant <= now)
      return this.subscribeDuration(0);
    return this.subscribeDuration(instant - now);
  },
  subscribeDuration(_duration) {
    _duration = BigInt(_duration);
    console.log(`[monotonic-clock] subscribe`);
  }
};
const wallClock = {
  now() {
    let now = Date.now();
    const seconds = BigInt(Math.floor(now / 1e3));
    const nanoseconds = now % 1e3 * 1e6;
    return { seconds, nanoseconds };
  },
  resolution() {
    return { seconds: 0n, nanoseconds: 1e6 };
  }
};
let id = 0;
const symbolDispose$1 = Symbol.dispose || Symbol.for("dispose");
const IoError = class Error2 {
  constructor(msg) {
    this.msg = msg;
  }
  toDebugString() {
    return this.msg;
  }
};
let InputStream$2 = class InputStream {
  /**
   * @param {InputStreamHandler} handler
   */
  constructor(handler) {
    if (!handler)
      console.trace("no handler");
    this.id = ++id;
    this.handler = handler;
  }
  read(len) {
    if (this.handler.read)
      return this.handler.read(len);
    return this.handler.blockingRead.call(this, len);
  }
  blockingRead(len) {
    return this.handler.blockingRead.call(this, len);
  }
  skip(len) {
    if (this.handler.skip)
      return this.handler.skip.call(this, len);
    if (this.handler.read) {
      const bytes = this.handler.read.call(this, len);
      return BigInt(bytes.byteLength);
    }
    return this.blockingSkip.call(this, len);
  }
  blockingSkip(len) {
    if (this.handler.blockingSkip)
      return this.handler.blockingSkip.call(this, len);
    const bytes = this.handler.blockingRead.call(this, len);
    return BigInt(bytes.byteLength);
  }
  subscribe() {
    console.log(`[streams] Subscribe to input stream ${this.id}`);
  }
  [symbolDispose$1]() {
    if (this.handler.drop)
      this.handler.drop.call(this);
  }
};
let OutputStream$2 = class OutputStream {
  /**
   * @param {OutputStreamHandler} handler
   */
  constructor(handler) {
    if (!handler)
      console.trace("no handler");
    this.id = ++id;
    this.open = true;
    this.handler = handler;
  }
  checkWrite(len) {
    if (!this.open)
      return 0n;
    if (this.handler.checkWrite)
      return this.handler.checkWrite.call(this, len);
    return 1000000n;
  }
  write(buf) {
    this.handler.write.call(this, buf);
  }
  blockingWriteAndFlush(buf) {
    this.handler.write.call(this, buf);
  }
  flush() {
    if (this.handler.flush)
      this.handler.flush.call(this);
  }
  blockingFlush() {
    this.open = true;
  }
  writeZeroes(len) {
    this.write.call(this, new Uint8Array(Number(len)));
  }
  blockingWriteZeroes(len) {
    this.blockingWrite.call(this, new Uint8Array(Number(len)));
  }
  blockingWriteZeroesAndFlush(len) {
    this.blockingWriteAndFlush.call(this, new Uint8Array(Number(len)));
  }
  splice(src, len) {
    const spliceLen = Math.min(len, this.checkWrite.call(this));
    const bytes = src.read(spliceLen);
    this.write.call(this, bytes);
    return bytes.byteLength;
  }
  blockingSplice(_src, _len) {
    console.log(`[streams] Blocking splice ${this.id}`);
  }
  forward(_src) {
    console.log(`[streams] Forward ${this.id}`);
  }
  subscribe() {
    console.log(`[streams] Subscribe to output stream ${this.id}`);
  }
  [symbolDispose$1]() {
  }
};
const error = { Error: IoError };
const streams = { InputStream: InputStream$2, OutputStream: OutputStream$2 };
class Pollable {
}
function pollList(_list) {
}
function pollOne(_poll) {
}
const poll = {
  Pollable,
  pollList,
  pollOne
};
const { InputStream: InputStream$1, OutputStream: OutputStream$1 } = streams;
const symbolDispose = Symbol.dispose ?? Symbol.for("dispose");
let _env = [], _args = [], _cwd$1 = null;
function _setEnv(envObj) {
  _env = Object.entries(envObj);
}
function _setArgs(args) {
  _args = args;
}
const environment = {
  getEnvironment() {
    return _env;
  },
  getArguments() {
    return _args;
  },
  initialCwd() {
    return _cwd$1;
  }
};
class ComponentExit extends Error {
  constructor(ok) {
    super(`Component exited ${ok ? "successfully" : "with error"}`);
    this.exitError = true;
    this.ok = ok;
  }
}
const exit = {
  exit(status) {
    throw new ComponentExit(status.tag === "err" ? true : false);
  }
};
function _setStdin(handler) {
  stdinStream.handler = handler;
}
function _setStderr(handler) {
  stderrStream.handler = handler;
}
function _setStdout(handler) {
  stdoutStream.handler = handler;
}
const stdinStream = new InputStream$1({
  blockingRead(_len) {
  },
  subscribe() {
  },
  [symbolDispose]() {
  }
});
let textDecoder = new TextDecoder();
const stdoutStream = new OutputStream$1({
  write(contents) {
    console.log(textDecoder.decode(contents));
  },
  blockingFlush() {
  },
  [symbolDispose]() {
  }
});
const stderrStream = new OutputStream$1({
  write(contents) {
    console.error(textDecoder.decode(contents));
  },
  blockingFlush() {
  },
  [symbolDispose]() {
  }
});
const stdin = {
  InputStream: InputStream$1,
  getStdin() {
    return stdinStream;
  }
};
const stdout = {
  OutputStream: OutputStream$1,
  getStdout() {
    return stdoutStream;
  }
};
const stderr = {
  OutputStream: OutputStream$1,
  getStderr() {
    return stderrStream;
  }
};
class TerminalInput {
}
class TerminalOutput {
}
const terminalStdoutInstance = new TerminalOutput();
const terminalStderrInstance = new TerminalOutput();
const terminalStdinInstance = new TerminalInput();
const terminalInput = {
  TerminalInput
};
const terminalOutput = {
  TerminalOutput
};
const terminalStderr = {
  TerminalOutput,
  getTerminalStderr() {
    return terminalStderrInstance;
  }
};
const terminalStdin = {
  TerminalInput,
  getTerminalStdin() {
    return terminalStdinInstance;
  }
};
const terminalStdout = {
  TerminalOutput,
  getTerminalStdout() {
    return terminalStdoutInstance;
  }
};
const { InputStream: InputStream2, OutputStream: OutputStream2 } = streams;
let _cwd = null;
function _setCwd(cwd) {
  _cwd = cwd;
}
function _setFileData(fileData) {
  _fileData = fileData;
  _rootPreopen[0] = new Descriptor(fileData);
  const cwd = environment.initialCwd();
  _setCwd(cwd || "/");
}
function _getFileData() {
  return JSON.stringify(_fileData);
}
let _fileData = { dir: {} };
const timeZero = {
  seconds: BigInt(0),
  nanoseconds: 0
};
function getChildEntry(parentEntry, subpath, openFlags) {
  if (subpath === "." && _rootPreopen && descriptorGetEntry(_rootPreopen[0]) === parentEntry) {
    subpath = _cwd;
    if (subpath.startsWith("/") && subpath !== "/")
      subpath = subpath.slice(1);
  }
  let entry = parentEntry;
  let segmentIdx;
  do {
    if (!entry || !entry.dir)
      throw "not-directory";
    segmentIdx = subpath.indexOf("/");
    const segment = segmentIdx === -1 ? subpath : subpath.slice(0, segmentIdx);
    if (segment === "." || segment === "")
      return entry;
    if (segment === "..")
      throw "no-entry";
    if (!entry.dir[segment] && openFlags.create)
      entry = entry.dir[segment] = openFlags.directory ? { dir: {} } : { source: new Uint8Array([]) };
    else
      entry = entry.dir[segment];
  } while (segmentIdx !== -1);
  if (!entry)
    throw "no-entry";
  return entry;
}
function getSource(fileEntry) {
  if (typeof fileEntry.source === "string") {
    fileEntry.source = new TextEncoder().encode(fileEntry.source);
  }
  return fileEntry.source;
}
class DirectoryEntryStream {
  constructor(entries) {
    this.idx = 0;
    this.entries = entries;
  }
  readDirectoryEntry() {
    if (this.idx === this.entries.length)
      return null;
    const [name, entry] = this.entries[this.idx];
    this.idx += 1;
    return {
      name,
      type: entry.dir ? "directory" : "regular-file"
    };
  }
}
const _Descriptor = class _Descriptor {
  constructor(entry, isStream) {
    __privateAdd(this, _stream, void 0);
    __privateAdd(this, _entry, void 0);
    __privateAdd(this, _mtime, 0);
    if (isStream)
      __privateSet(this, _stream, entry);
    else
      __privateSet(this, _entry, entry);
  }
  _getEntry(descriptor) {
    return __privateGet(descriptor, _entry);
  }
  readViaStream(_offset) {
    const source = getSource(__privateGet(this, _entry));
    let offset = Number(_offset);
    return new InputStream2({
      blockingRead(len) {
        if (offset === source.byteLength)
          throw { tag: "closed" };
        const bytes = source.slice(offset, offset + Number(len));
        offset += bytes.byteLength;
        return bytes;
      }
    });
  }
  writeViaStream(_offset) {
    const entry = __privateGet(this, _entry);
    let offset = Number(_offset);
    return new OutputStream2({
      write(buf) {
        const newSource = new Uint8Array(buf.byteLength + entry.source.byteLength);
        newSource.set(entry.source, 0);
        newSource.set(buf, offset);
        offset += buf.byteLength;
        entry.source = newSource;
        return buf.byteLength;
      }
    });
  }
  appendViaStream() {
    console.log(`[filesystem] APPEND STREAM`);
  }
  advise(descriptor, offset, length, advice) {
    console.log(`[filesystem] ADVISE`, descriptor, offset, length, advice);
  }
  syncData() {
    console.log(`[filesystem] SYNC DATA`);
  }
  getFlags() {
    console.log(`[filesystem] FLAGS FOR`);
  }
  getType() {
    if (__privateGet(this, _stream))
      return "fifo";
    if (__privateGet(this, _entry).dir)
      return "directory";
    if (__privateGet(this, _entry).source)
      return "regular-file";
    return "unknown";
  }
  setSize(size) {
    console.log(`[filesystem] SET SIZE`, size);
  }
  setTimes(dataAccessTimestamp, dataModificationTimestamp) {
    console.log(`[filesystem] SET TIMES`, dataAccessTimestamp, dataModificationTimestamp);
  }
  read(length, offset) {
    const source = getSource(__privateGet(this, _entry));
    return [source.slice(offset, offset + length), offset + length >= source.byteLength];
  }
  write(buffer, offset) {
    if (offset !== 0)
      throw "invalid-seek";
    __privateGet(this, _entry).source = buffer;
    return buffer.byteLength;
  }
  readDirectory() {
    var _a;
    if (!((_a = __privateGet(this, _entry)) == null ? void 0 : _a.dir))
      throw "bad-descriptor";
    return new DirectoryEntryStream(Object.entries(__privateGet(this, _entry).dir).sort(([a], [b]) => a > b ? 1 : -1));
  }
  sync() {
    console.log(`[filesystem] SYNC`);
  }
  createDirectoryAt(path) {
    const entry = getChildEntry(__privateGet(this, _entry), path, { create: true, directory: true });
    if (entry.source)
      throw "exist";
  }
  stat() {
    let type = "unknown", size = BigInt(0);
    if (__privateGet(this, _entry).source) {
      type = "directory";
    } else if (__privateGet(this, _entry).dir) {
      type = "regular-file";
      const source = getSource(__privateGet(this, _entry));
      size = BigInt(source.byteLength);
    }
    return {
      type,
      linkCount: BigInt(0),
      size,
      dataAccessTimestamp: timeZero,
      dataModificationTimestamp: timeZero,
      statusChangeTimestamp: timeZero
    };
  }
  statAt(_pathFlags, path) {
    const entry = getChildEntry(__privateGet(this, _entry), path);
    let type = "unknown", size = BigInt(0);
    if (entry.source) {
      type = "regular-file";
      const source = getSource(entry);
      size = BigInt(source.byteLength);
    } else if (entry.dir) {
      type = "directory";
    }
    return {
      type,
      linkCount: BigInt(0),
      size,
      dataAccessTimestamp: timeZero,
      dataModificationTimestamp: timeZero,
      statusChangeTimestamp: timeZero
    };
  }
  setTimesAt() {
    console.log(`[filesystem] SET TIMES AT`);
  }
  linkAt() {
    console.log(`[filesystem] LINK AT`);
  }
  openAt(_pathFlags, path, openFlags, _descriptorFlags, _modes) {
    const childEntry = getChildEntry(__privateGet(this, _entry), path, openFlags);
    return new _Descriptor(childEntry);
  }
  readlinkAt() {
    console.log(`[filesystem] READLINK AT`);
  }
  removeDirectoryAt() {
    console.log(`[filesystem] REMOVE DIR AT`);
  }
  renameAt() {
    console.log(`[filesystem] RENAME AT`);
  }
  symlinkAt() {
    console.log(`[filesystem] SYMLINK AT`);
  }
  unlinkFileAt() {
    console.log(`[filesystem] UNLINK FILE AT`);
  }
  isSameObject(other) {
    return other === this;
  }
  metadataHash() {
    let upper = BigInt(0);
    upper += BigInt(__privateGet(this, _mtime));
    return { upper, lower: BigInt(0) };
  }
  metadataHashAt(_pathFlags, _path) {
    let upper = BigInt(0);
    upper += BigInt(__privateGet(this, _mtime));
    return { upper, lower: BigInt(0) };
  }
};
_stream = new WeakMap();
_entry = new WeakMap();
_mtime = new WeakMap();
let Descriptor = _Descriptor;
const descriptorGetEntry = Descriptor.prototype._getEntry;
delete Descriptor.prototype._getEntry;
let _preopens = [[new Descriptor(_fileData), "/"]], _rootPreopen = _preopens[0];
const preopens = {
  getDirectories() {
    return _preopens;
  }
};
const types = {
  Descriptor,
  DirectoryEntryStream
};
class UnexpectedError {
  constructor(msg) {
    this.msg = msg;
  }
  toDebugString() {
    return this.msg;
  }
}
function send(req) {
  console.log(`[http] Send (browser) ${req.uri}`);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open(req.method.toString(), req.uri, false);
    const requestHeaders = new Headers(req.headers);
    for (let [name, value] of requestHeaders.entries()) {
      if (name !== "user-agent" && name !== "host") {
        xhr.setRequestHeader(name, value);
      }
    }
    xhr.send(req.body && req.body.length > 0 ? req.body : null);
    const body = xhr.response ? new TextEncoder().encode(xhr.response) : void 0;
    const headers = [];
    xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach((line) => {
      var parts = line.split(": ");
      var key = parts.shift();
      var value = parts.join(": ");
      headers.push([key, value]);
    });
    return {
      status: xhr.status,
      headers,
      body
    };
  } catch (err) {
    throw new UnexpectedError(err.message);
  }
}
const incomingHandler = {
  handle() {
  }
};
const outgoingHandler = {
  handle() {
  }
};
const MAX_BYTES = 65536;
let insecureRandomValue1, insecureRandomValue2;
const insecure = {
  getInsecureRandomBytes(len) {
    return random.getRandomBytes(len);
  },
  getInsecureRandomU64() {
    return random.getRandomU64();
  }
};
let insecureSeedValue1, insecureSeedValue2;
const insecureSeed = {
  insecureSeed() {
    if (insecureSeedValue1 === void 0) {
      insecureSeedValue1 = random.getRandomU64();
      insecureSeedValue2 = random.getRandomU64();
    }
    return [insecureSeedValue1, insecureSeedValue2];
  }
};
const random = {
  getRandomBytes(len) {
    const bytes = new Uint8Array(Number(len));
    if (len > MAX_BYTES) {
      for (var generated = 0; generated < len; generated += MAX_BYTES) {
        crypto.getRandomValues(bytes.slice(generated, generated + MAX_BYTES));
      }
    } else {
      crypto.getRandomValues(bytes);
    }
    return bytes;
  },
  getRandomU64() {
    return crypto.getRandomValues(new BigUint64Array(1))[0];
  },
  insecureRandom() {
    if (insecureRandomValue1 === void 0) {
      insecureRandomValue1 = random.getRandomU64();
      insecureRandomValue2 = random.getRandomU64();
    }
    return [insecureRandomValue1, insecureRandomValue2];
  }
};
const instanceNetwork = {
  instanceNetwork() {
    console.log(`[sockets] instance network`);
  }
};
const ipNameLookup = {
  dropResolveAddressStream() {
  },
  subscribe() {
  },
  resolveAddresses() {
  },
  resolveNextAddress() {
  },
  nonBlocking() {
  },
  setNonBlocking() {
  }
};
const network = {
  dropNetwork() {
  }
};
const tcpCreateSocket = {
  createTcpSocket() {
  }
};
const tcp = {
  subscribe() {
  },
  dropTcpSocket() {
  },
  bind() {
  },
  connect() {
  },
  listen() {
  },
  accept() {
  },
  localAddress() {
  },
  remoteAddress() {
  },
  addressFamily() {
  },
  ipv6Only() {
  },
  setIpv6Only() {
  },
  setListenBacklogSize() {
  },
  keepAlive() {
  },
  setKeepAlive() {
  },
  noDelay() {
  },
  setNoDelay() {
  },
  unicastHopLimit() {
  },
  setUnicastHopLimit() {
  },
  receiveBufferSize() {
  },
  setReceiveBufferSize() {
  },
  sendBufferSize() {
  },
  setSendBufferSize() {
  },
  nonBlocking() {
  },
  setNonBlocking() {
  },
  shutdown() {
  }
};
const udp = {
  subscribe() {
  },
  dropUdpSocket() {
  },
  bind() {
  },
  connect() {
  },
  receive() {
  },
  send() {
  },
  localAddress() {
  },
  remoteAddress() {
  },
  addressFamily() {
  },
  ipv6Only() {
  },
  setIpv6Only() {
  },
  unicastHopLimit() {
  },
  setUnicastHopLimit() {
  },
  receiveBufferSize() {
  },
  setReceiveBufferSize() {
  },
  sendBufferSize() {
  },
  setSendBufferSize() {
  },
  nonBlocking() {
  },
  setNonBlocking() {
  }
};
const udpCreateSocket = {
  createUdpSocket() {
  }
};
export {
  _getFileData,
  _setArgs,
  _setEnv,
  _setFileData,
  _setStderr,
  _setStdin,
  _setStdout,
  environment,
  error,
  exit,
  types as filesystemTypes,
  incomingHandler,
  insecure,
  insecureSeed,
  instanceNetwork,
  ipNameLookup,
  monotonicClock,
  network,
  outgoingHandler,
  poll,
  preopens,
  random,
  send,
  stderr,
  stdin,
  stdout,
  streams,
  tcp,
  tcpCreateSocket,
  terminalInput,
  terminalOutput,
  terminalStderr,
  terminalStdin,
  terminalStdout,
  types,
  udp,
  udpCreateSocket,
  wallClock
};
