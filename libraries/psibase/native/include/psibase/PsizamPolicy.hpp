#pragma once

#include <filesystem>
#include <psibase/block.hpp>
#include <psizam/config.hpp>
#include <psizam/options.hpp>
#include <span>
#include <array>
#include <memory>
#include <optional>
#include <vector>

namespace psibase
{
   class NativeAotCache;
   /// PSIBASE_NATIVE_AOT_CACHE when set, otherwise `fallback`.
   std::filesystem::path nativeAotCachePath(const std::filesystem::path& fallback);
   /// The cache for a process that configures none: PSIBASE_NATIVE_AOT_CACHE,
   /// else one shared by the user's processes.
   std::shared_ptr<NativeAotCache> nativeAotCacheFromEnvironment();

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

}  // namespace psibase
