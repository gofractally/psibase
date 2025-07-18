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
const jcoShims = globalThis.__jcoShims;
if (!jcoShims) {
    throw new Error('JCO shims not initialized');
}

// Export the required interfaces using the wrapper
export const environment = createShimWrapper(jcoShims.cli.environment);
export const exit = createShimWrapper(jcoShims.cli.exit);
export const stderr = createShimWrapper(jcoShims.cli.stderr);
export const stdin = createShimWrapper(jcoShims.cli.stdin);
export const stdout = createShimWrapper(jcoShims.cli.stdout);
export const monotonicClock = createShimWrapper(jcoShims.clocks.monotonicClock);
export const wallClock = createShimWrapper(jcoShims.clocks.wallClock);
export const types = createShimWrapper(jcoShims.filesystem.types);
export const preopens = createShimWrapper(jcoShims.filesystem.preopens);
export const error = createShimWrapper(jcoShims.io.error);
export const streams = createShimWrapper(jcoShims.io.streams);
export const random = createShimWrapper(jcoShims.random.random);