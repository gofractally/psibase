// WASI shim code generated from @bytecodealliance/preview2-shim
// Direct exports without instrumentation

// We'll use a global reference to the JCO shims that was set at load time
const preview2Shims = globalThis.__preview2Shims;
if (!preview2Shims) {
    throw new Error('JCO shims not initialized');
}

// Export the WASI interfaces directly
export const environment = preview2Shims.cli.environment;
export const exit = preview2Shims.cli.exit;
export const stderr = preview2Shims.cli.stderr;
export const stdin = preview2Shims.cli.stdin;
export const stdout = preview2Shims.cli.stdout;
export const monotonicClock = preview2Shims.clocks.monotonicClock;
export const wallClock = preview2Shims.clocks.wallClock;
export const types = preview2Shims.filesystem.types;
export const preopens = preview2Shims.filesystem.preopens;
export const error = preview2Shims.io.error;
export const streams = preview2Shims.io.streams;
export const random = preview2Shims.random.random;