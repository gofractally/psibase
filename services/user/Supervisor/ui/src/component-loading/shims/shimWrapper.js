// WASI shim code generated from @bytecodealliance/preview2-shim
// This code creates a runtime wrapper for JCO functions

// Create function wrappers that call the original JCO implementations
const createShimWrapper = (originalShim) => {
    // Return a proxy that maintains the original functionality
    return new Proxy(originalShim, {
        get(target, prop) {
            const value = target[prop];
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        }
    });
};

// We'll use a global reference to the JCO shims that was set at load time
const preview2Shims = globalThis.__preview2Shims;
if (!preview2Shims) {
    throw new Error('JCO shims not initialized');
}

// Export the required interfaces using the wrapper
export const environment = createShimWrapper(preview2Shims.cli.environment);
export const exit = createShimWrapper(preview2Shims.cli.exit);
export const stderr = createShimWrapper(preview2Shims.cli.stderr);
export const stdin = createShimWrapper(preview2Shims.cli.stdin);
export const stdout = createShimWrapper(preview2Shims.cli.stdout);
export const monotonicClock = createShimWrapper(preview2Shims.clocks.monotonicClock);
export const wallClock = createShimWrapper(preview2Shims.clocks.wallClock);
export const types = createShimWrapper(preview2Shims.filesystem.types);
export const preopens = createShimWrapper(preview2Shims.filesystem.preopens);
export const error = createShimWrapper(preview2Shims.io.error);
export const streams = createShimWrapper(preview2Shims.io.streams);
export const random = createShimWrapper(preview2Shims.random.random);