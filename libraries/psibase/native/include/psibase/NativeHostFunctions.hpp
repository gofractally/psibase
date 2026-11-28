#pragma once

// The host functions a service may import: the one list.
//
// Every execution engine registers exactly these, as module "env", from this
// list, and the admission rule (admitNativeWasm) checks a module's imports
// against the table made from it. A module that imports anything else is
// refused when its code is stored, so the list is a consensus rule: adding,
// removing or changing the signature of an entry changes which code every
// node accepts.
//
// X(name) names a member function of NativeFunctions; its wasm signature is
// derived from the C++ one (an integer is i32 or i64 by size, a span is a
// pointer and a length, a pointer proxy is an i32).
//
// What a function may do in a given context (subjective or not, privileged
// or not) is decided when it is called, not here.
//
// TODO: kvGetTransactionUsage is not listed until its interface is final.
// Leaving it out now simplifies future upgrades.

#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

#define PSIBASE_NATIVE_HOST_FUNCTIONS(X) \
   X(getResult)                          \
   X(getKey)                             \
   X(writeConsole)                       \
   X(abortMessage)                       \
   X(clockTimeGet)                       \
   X(getRandom)                          \
   X(setMaxCpuTime)                      \
   X(getCurrentAction)                   \
   X(call)                               \
   X(setRetval)                          \
   X(kvOpen)                             \
   X(kvOpenAt)                           \
   X(kvClose)                            \
   X(exportHandles)                      \
   X(importHandles)                      \
   X(kvPut)                              \
   X(kvRemove)                           \
   X(kvGet)                              \
   X(kvGreaterEqual)                     \
   X(kvLessThan)                         \
   X(kvMax)                              \
   X(checkoutSubjective)                 \
   X(commitSubjective)                   \
   X(abortSubjective)                    \
   X(socketOpen)                         \
   X(socketSend)                         \
   X(socketSetFlags)                     \
   X(readFile)                           \
   X(fileAppend)                         \
   X(fileCommit)                         \
   X(fileRemove)                         \
   X(fileSize)                           \
   X(fileRead)

namespace psibase
{
   /// One importable function. Types are WebAssembly value types as they are
   /// encoded in a module (0x7f i32, 0x7e i64, 0x7d f32, 0x7c f64).
   struct NativeHostFunction
   {
      std::string_view          module;
      std::string_view          name;
      std::vector<std::uint8_t> params;
      std::vector<std::uint8_t> results;
   };

   /// The table: PSIBASE_NATIVE_HOST_FUNCTIONS with signatures, in list order.
   const std::vector<NativeHostFunction>& nativeHostFunctions();

   /// An engine reports each function it has registered, and then how many.
   /// Both throw if the engine does not provide exactly the table: a node
   /// whose engine disagrees with the admission rule must not start.
   void checkNativeHostFunction(std::string_view              engine,
                                std::string_view              name,
                                std::span<const std::uint8_t> params,
                                std::span<const std::uint8_t> results);
   void checkNativeHostFunctionCount(std::string_view engine, std::size_t registered);
}  // namespace psibase
