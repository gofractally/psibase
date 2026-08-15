// Tracks live WebAssembly instances and memories so the Supervisor can log
// how much wasm virtual address space is resident. Chromium reserves a large
// contiguous virtual range per WebAssembly.Memory, so too many live memories
// makes WebAssembly.instantiate() throw "Out of memory: Cannot allocate Wasm
// memory for new instance" long before physical memory is exhausted.
//
// Counts decrement when the GC collects an instance/memory (that is also when
// Chromium releases the address-space reservation), so "live" here means
// "still reachable or not yet collected".

export interface WasmMemStats {
    // Total core-module instantiations since page load.
    instantiations: number;
    liveInstances: number;
    liveMemories: number;
}

const stats: WasmMemStats = {
    instantiations: 0,
    liveInstances: 0,
    liveMemories: 0,
};

const registry = new FinalizationRegistry<"instance" | "memory">((kind) => {
    if (kind === "instance") {
        stats.liveInstances--;
    } else {
        stats.liveMemories--;
    }
});

function track(instance: WebAssembly.Instance): void {
    stats.instantiations++;
    stats.liveInstances++;
    registry.register(instance, "instance");
    // jco-generated core modules define and export their linear memory, so
    // counting exported memories counts the allocations that matter.
    for (const exp of Object.values(instance.exports)) {
        if (exp instanceof WebAssembly.Memory) {
            stats.liveMemories++;
            registry.register(exp, "memory");
        }
    }
}

let installed = false;

// Must run before the first WebAssembly.instantiate() call in this frame.
export function installWasmMetrics(): void {
    if (installed) return;
    installed = true;
    const original = WebAssembly.instantiate.bind(
        WebAssembly,
    ) as (
        source: WebAssembly.Module | BufferSource,
        imports?: WebAssembly.Imports,
    ) => Promise<WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource>;
    WebAssembly.instantiate = (async (
        source: WebAssembly.Module | BufferSource,
        imports?: WebAssembly.Imports,
    ) => {
        const result = await original(source, imports);
        track(result instanceof WebAssembly.Instance ? result : result.instance);
        return result;
    }) as typeof WebAssembly.instantiate;
}

export function wasmMemStats(): WasmMemStats {
    return { ...stats };
}
