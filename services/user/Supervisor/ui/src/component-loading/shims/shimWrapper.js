// WASI shim code generated from @bytecodealliance/preview2-shim
// Direct exports with performance instrumentation

// We'll use a global reference to the JCO shims that was set at load time
const preview2Shims = globalThis.__preview2Shims;
if (!preview2Shims) {
    throw new Error('JCO shims not initialized');
}

// Performance tracking
const wasiCallTimes = globalThis.__wasiCallTimes = globalThis.__wasiCallTimes || {};
let totalCalls = 0;

function wrapWithTiming(obj, objName) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const wrapped = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'function') {
            wrapped[key] = function(...args) {
                const callId = `${objName}.${key}`;
                const start = performance.now();
                totalCalls++;
                
                try {
                    const result = value.apply(this, args);
                    const duration = performance.now() - start;
                    
                    if (!wasiCallTimes[callId]) {
                        wasiCallTimes[callId] = { count: 0, totalTime: 0, maxTime: 0 };
                    }
                    wasiCallTimes[callId].count++;
                    wasiCallTimes[callId].totalTime += duration;
                    wasiCallTimes[callId].maxTime = Math.max(wasiCallTimes[callId].maxTime, duration);
                    
                    if (duration > 5) { // Log slow calls (>5ms)
                        console.log(`[WASI-TIMING] ${callId}: ${duration.toFixed(2)}ms (call #${totalCalls})`);
                    }
                    
                    return result;
                } catch (error) {
                    const duration = performance.now() - start;
                    console.log(`[WASI-ERROR] ${callId}: ${duration.toFixed(2)}ms - ${error}`);
                    throw error;
                }
            };
        } else if (typeof value === 'object' && value !== null) {
            wrapped[key] = wrapWithTiming(value, `${objName}.${key}`);
        } else {
            wrapped[key] = value;
        }
    }
    return wrapped;
}

// Add global function to dump timing stats
globalThis.__dumpWasiStats = function() {
    console.log('\n=== WASI Call Performance Stats ===');
    console.log(`Total WASI calls: ${totalCalls}`);
    
    const sorted = Object.entries(wasiCallTimes)
        .sort((a, b) => b[1].totalTime - a[1].totalTime);
    
    for (const [call, stats] of sorted) {
        const avgTime = stats.totalTime / stats.count;
        console.log(`${call}: ${stats.count} calls, ${stats.totalTime.toFixed(2)}ms total, ${avgTime.toFixed(2)}ms avg, ${stats.maxTime.toFixed(2)}ms max`);
    }
    console.log('=====================================\n');
};

// Export the instrumented interfaces
export const environment = wrapWithTiming(preview2Shims.cli.environment, 'cli.environment');
export const exit = wrapWithTiming(preview2Shims.cli.exit, 'cli.exit');
export const stderr = wrapWithTiming(preview2Shims.cli.stderr, 'cli.stderr');
export const stdin = wrapWithTiming(preview2Shims.cli.stdin, 'cli.stdin');
export const stdout = wrapWithTiming(preview2Shims.cli.stdout, 'cli.stdout');
export const monotonicClock = wrapWithTiming(preview2Shims.clocks.monotonicClock, 'clocks.monotonicClock');
export const wallClock = wrapWithTiming(preview2Shims.clocks.wallClock, 'clocks.wallClock');
export const types = wrapWithTiming(preview2Shims.filesystem.types, 'filesystem.types');
export const preopens = wrapWithTiming(preview2Shims.filesystem.preopens, 'filesystem.preopens');
export const error = wrapWithTiming(preview2Shims.io.error, 'io.error');
export const streams = wrapWithTiming(preview2Shims.io.streams, 'io.streams');
export const random = wrapWithTiming(preview2Shims.random.random, 'random.random');