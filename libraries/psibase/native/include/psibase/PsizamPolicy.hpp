#pragma once

#include <filesystem>
#include <psibase/block.hpp>
#include <psibase/storage.hpp>
#include <psizam/config.hpp>
#include <psizam/options.hpp>
#include <span>
#include <array>
#include <memory>
#include <optional>
#include <vector>

namespace psizam
{
   struct module;
}

namespace psibase
{
   class NativeAotCache;
   /// PSIBASE_NATIVE_AOT_CACHE when set, otherwise `fallback`.
   std::filesystem::path nativeAotCachePath(const std::filesystem::path& fallback);
   /// The cache for a process that configures none: PSIBASE_NATIVE_AOT_CACHE,
   /// else one shared by the user's processes.
   std::shared_ptr<NativeAotCache> nativeAotCacheFromEnvironment();
   /// The cache of a node: records under `root`, the root of the node's
   /// database that is no part of the chain (NativeAotDatabase), holding at
   /// most PSIBASE_NATIVE_AOT_CACHE_MB MiB if that is set. Starting the node
   /// with PSIBASE_NATIVE_AOT_CACHE_CLEAR=1 empties that root first: every
   /// module is then compiled again when it is next needed, and nothing else
   /// changes. If PSIBASE_NATIVE_AOT_CACHE is set it names a directory to use
   /// instead, as for every other program: that is how the nodes of a test
   /// share what one of them compiled, which a root of one node's database
   /// cannot.
   std::shared_ptr<NativeAotCache> nodeNativeAotCache(storage::cache_root root);

   /// The float profile a code version (CodeRow::vmVersion) executes under:
   /// 0 is the strict WebAssembly deterministic profile, 1 the deterministic
   /// performance profile (fused relaxed_madd). A version this node does not
   /// know has none and its code is refused, never run under another policy.
   std::optional<psizam::float_profile> nativeFloatProfile(std::uint8_t vmVersion);

   // Keep chain VMOptions and its wire reflection unchanged. These native-only
   // choices are explicit instead of inheriting the general runtime defaults.
   struct NativeVMOptions : VMOptions
   {
      static constexpr auto          fp                          = psizam::fp_mode::softfloat;
      static constexpr auto          memory_mode                 = psizam::mem_safety::guarded;
      static constexpr auto          checked_kind                = psizam::checked_mode::strict;
      static constexpr bool          gas_metering                = false;
      static constexpr bool          limit_table_growth          = true;
      static constexpr bool          defer_start                 = true;
      static constexpr bool          enable_exception_handling   = false;
      static constexpr bool          enable_atomics              = true;
      static constexpr bool          enable_relaxed_simd         = true;
      static constexpr bool          enable_tail_calls           = false;
      // Incoming arguments remain live across normal and tail calls. Count
      // their storage in the same deterministic logical budget on every engine.
      static constexpr auto max_func_local_bytes_flags =
          psizam::max_func_local_bytes_flags_t::params |
          psizam::max_func_local_bytes_flags_t::locals |
          psizam::max_func_local_bytes_flags_t::stack;
      static constexpr std::uint32_t max_memory_section_elements = 1;

      // Set from the executing code's version; every engine and the artifact
      // identity take it from here.
      psizam::float_profile float_profile = psizam::float_profile::strict;

      std::shared_ptr<NativeAotCache> nativeArtifacts;
      // Diagnostic mode used to prove a warm run needs no compiler fallback.
      bool native_aot_cache_only = false;

      explicit NativeVMOptions(const VMOptions& options,
                               std::shared_ptr<NativeAotCache> artifacts = {},
                               std::uint8_t vmVersion = 0);
      std::array<std::uint8_t, 32> native_aot_identity(
          std::span<const std::uint8_t> wasm, std::uint32_t maximumFunctionBytes,
          psizam::max_func_local_bytes_flags_t components,
          bool backtrace, bool byteStack) const;
      std::vector<char> load_native_aot(const std::array<std::uint8_t, 32>& identity) const;
      void store_native_aot(const std::array<std::uint8_t, 32>& identity,
                            std::span<const char> artifact) const noexcept;
   };

   // Reject resource/import models that the node's single-memory host ABI does
   // not implement before the general parser allocates or compiles the module.
   void validateNativeWasm(std::span<const std::uint8_t> code, const NativeVMOptions& options);

   /// The functions the node calls a service through, as the module exports
   /// them: each is the wasm function index (in the function index space, so
   /// imported functions count) of the export of that name, or nothing if
   /// the module has no such export.
   ///
   /// Part of the admission rule: an export with one of these names must be
   /// a function with exactly this signature, or the module is refused.
   ///
   ///    start:              (i64) -> ()       this service
   ///    called:             (i64, i64) -> ()  this service, sender
   ///    serve:              () -> ()
   ///    processTransaction: () -> ()
   ///
   /// None is required to exist yet (gofractally/psibase#2261): a service
   /// without one fails when the node tries to call it, as before.
   struct NativeEntryPoints
   {
      std::optional<std::uint32_t> start;
      std::optional<std::uint32_t> called;
      std::optional<std::uint32_t> serve;
      std::optional<std::uint32_t> processTransaction;
      friend bool operator==(const NativeEntryPoints&, const NativeEntryPoints&) = default;
   };

   /// What admission learns about a module it admits.
   struct NativeAdmission
   {
      /// psizam's stack byte cost of each defined function, in order (what
      /// wasmtime's metered compile needs).
      std::vector<std::uint32_t> costs;
      NativeEntryPoints          entryPoints;
   };

   /// The entry points of a module psizam has parsed, checked as above.
   /// admitNativeWasm does this; an engine that parses the module itself
   /// calls it on its own parse. Throws std::runtime_error with the reason.
   NativeEntryPoints nativeEntryPoints(const psizam::module& module);

   /// The chain's admission rule for service code, the same on every engine:
   /// the version names a float profile, validateNativeWasm, psizam's parser
   /// and validator under NativeVMOptions, and every import is a host
   /// function of NativeHostFunctions.hpp with that function's signature, and
   /// every entry point it exports has its fixed signature (NativeEntryPoints). It
   /// reads nothing but its arguments and that fixed table, so every node
   /// decides alike. It runs when a code row is
   /// written (failure aborts the transaction) and again before an engine
   /// compiles the code (the limits may have changed since it was stored).
   ///
   /// Not covered: limits of an engine's own compiler. Those surface when the
   /// code is first executed; a compiler that refuses admitted code is a
   /// fault of that node's engine, never a property of the transaction.
   ///
   /// Throws std::runtime_error with the reason.
   NativeAdmission admitNativeWasm(std::span<const std::uint8_t> code,
                                   const VMOptions&              options,
                                   std::uint8_t                  vmVersion);

}  // namespace psibase
