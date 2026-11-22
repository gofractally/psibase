#pragma once
#include <psizam/backend.hpp>

#if defined(PSIBASE_VM_LLVM_AOT)
#include <psizam/aot.hpp>
#endif

namespace psibase
{
#if defined(PSIBASE_VM_LLVM_AOT)
   using NativeVM = psizam::aot_profile;
#elif defined(PSIBASE_VM_JIT2) || defined(PSIBASE_VM_WASMTIME)
   // With the wasmtime node engine, this profile is what the tester and the
   // psizam-specific tests run on.
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
