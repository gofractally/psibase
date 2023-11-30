# Custom wasm runtime

All WebAssembly modules must execute in a highly performant and fully deterministic WebAssembly virtual machine. The WebAssembly specification has made some [non-deterministic design choices](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md), because of which the default runtimes are insufficient for a blockchain use-case.

Psibase therefore defines a custom WebAssembly run-time based on a battle-tested and deterministic runtime called [EOS VM](https://github.com/AntelopeIO/eos-vm). The psibase VM specification adds further requirements above and beyond the EOS VM implementation.

# Goals

- Support [bulk memory operations](https://github.com/WebAssembly/spec/blob/main/proposals/bulk-memory-operations/Overview.md)
- Support [sign extension operators](https://github.com/WebAssembly/spec/blob/main/proposals/sign-extension-ops/Overview.md)
- Better generated code optimization
- Add [non-trapping float-to-int conversions](https://github.com/WebAssembly/spec/blob/main/proposals/nontrapping-float-to-int-conversion/Overview.md)
- Support [128-bit SIMD instructions](https://github.com/WebAssembly/spec/blob/main/proposals/simd/SIMD.md) to accelerate some wasm computation such as cryptographic operations
- Support using the latest WASI SDK (Currently [wasi-sdk-20](https://github.com/WebAssembly/wasi-sdk/releases))
- Maintain full determinism developed for EOS VM

# Reference implementation

The reference implementation for the custom Psibase WebAssembly runtime currently satisfies all goals. It can be found [here](https://github.com/gofractally/eos-vm).
