export namespace WasiFilesystemPreopens {
  export function getDirectories(): [Descriptor, string][];
}
import type { Descriptor } from '../interfaces/wasi-filesystem-types.js';
export { Descriptor };
