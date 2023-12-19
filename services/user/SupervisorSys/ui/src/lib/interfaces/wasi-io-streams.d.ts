export namespace WasiIoStreams {
  export { OutputStream };
  export { InputStream };
}
import type { Error } from '../interfaces/wasi-io-error.js';
export { Error };
export type StreamError = StreamErrorLastOperationFailed | StreamErrorClosed;
export interface StreamErrorLastOperationFailed {
  tag: 'last-operation-failed',
  val: Error,
}
export interface StreamErrorClosed {
  tag: 'closed',
}

export class InputStream {
}

export class OutputStream {
  checkWrite(): bigint;
  write(contents: Uint8Array): void;
  blockingWriteAndFlush(contents: Uint8Array): void;
  blockingFlush(): void;
}
