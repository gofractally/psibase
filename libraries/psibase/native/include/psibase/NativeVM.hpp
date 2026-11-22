#pragma once
#include <psizam/backend.hpp>

#if defined(PSIBASE_VM_LLVM_AOT)
#include <psizam/aot.hpp>
#endif

namespace psibase
{
   // An engine adapter compiled for one profile says which with
   // PSIBASE_VM_ADAPTER_*. Everything else (the tester, the psizam-specific
   // tests) gets the build's profile; with a wasmtime or multi-engine node
   // that is JIT2.
#if defined(PSIBASE_VM_ADAPTER_JIT1)
   using NativeVM = psizam::jit_profile;
#elif defined(PSIBASE_VM_ADAPTER_JIT2)
   struct NativeVM : psizam::jit2
   {
      using context = psizam::detail::jit_execution_context<true>;
      static constexpr bool enable_backtrace = true;
   };
#elif defined(PSIBASE_VM_LLVM_AOT)
   using NativeVM = psizam::aot_profile;
#elif defined(PSIBASE_VM_JIT2) || defined(PSIBASE_VM_WASMTIME) || defined(PSIBASE_VM_DYNAMIC)
   struct NativeVM : psizam::jit2
   {
      using context = psizam::detail::jit_execution_context<true>;
      static constexpr bool enable_backtrace = true;
   };
#elif defined(PSIBASE_VM_JIT1)
   using NativeVM = psizam::jit_profile;
#else
#error A native VM profile must be selected by CMake
#endif
}
