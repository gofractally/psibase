#pragma once

// What every use of the psizam wasmtime backend in psibase shares: the node's
// service engine (ExecutionContextWasmtime.cpp) and the tester's engine for
// the test module (programs/psitest). Each has engines of its own, since an
// engine's host functions and options are part of it, but both bind host
// functions the same way and state the same proposal set.

#include <psizam/detail/argument_proxy.hpp>
#include <psizam/wasmtime_backend.hpp>

#include <array>
#include <cstdint>

// Pointer arguments the host ABI takes through psizam's unaligned proxy: one
// i32 offset into linear memory, checked for sizeof(T) bytes.
template <typename T>
struct psizam::wasmtime::detail::value_traits<psizam::detail::argument_proxy<T*>>
{
   static constexpr std::array<uint8_t, 1> types{type_i32};
   static constexpr bool                   reads_memory = true;
   static psizam::detail::argument_proxy<T*> load(const abi::PzwtValue* v, memory_view m)
   {
      std::uint64_t ptr = static_cast<std::uint32_t>(v->i32);
      if (ptr > m.size || sizeof(T) > m.size - ptr)
         throw host_memory_error("host pointer is outside linear memory");
      return {m.base + ptr};
   }
};

namespace psibase::vm_wasmtime
{
   // The WebAssembly proposals a module may use, for services and for test
   // modules alike. Everything else the engine knows is off (the shim states
   // each one): tail calls, exceptions, memory64, multi-memory, GC, typed
   // function references, shared memories. Wide arithmetic is always on.
   inline constexpr std::uint32_t wasmFeatures =
       psizam::wasmtime::feature::simd | psizam::wasmtime::feature::relaxed_simd |
       psizam::wasmtime::feature::bulk_memory | psizam::wasmtime::feature::sign_extension |
       psizam::wasmtime::feature::saturating_float_to_int |
       psizam::wasmtime::feature::reference_types | psizam::wasmtime::feature::multi_value |
       psizam::wasmtime::feature::threads;

   // Native stack the service engine gives wasm, per executing thread, when
   // a service is the outermost wasm on the thread. A caller that is itself
   // wasm on another engine (the tester's test module) must leave this much
   // below its own frames: a service entered from it runs on the caller's
   // native stack.
   inline constexpr std::uint64_t serviceNativeStackBytes = std::uint64_t(256) << 20;
}  // namespace psibase::vm_wasmtime
