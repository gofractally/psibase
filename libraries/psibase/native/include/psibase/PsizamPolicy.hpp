#pragma once

#include <psibase/block.hpp>
#include <psizam/config.hpp>
#include <psizam/options.hpp>
#include <span>

namespace psibase
{
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
      static constexpr std::uint32_t max_memory_section_elements = 1;

      explicit NativeVMOptions(const VMOptions& options);
   };

   // Reject resource/import models that the node's single-memory host ABI does
   // not implement before the general parser allocates or compiles the module.
   void validateNativeWasm(std::span<const std::uint8_t> code, const NativeVMOptions& options);

}  // namespace psibase
