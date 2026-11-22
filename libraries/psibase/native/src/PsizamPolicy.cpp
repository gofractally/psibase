#include <algorithm>
#include <limits>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/crypto.hpp>
#include <cstdlib>
#include <tuple>
#include <unistd.h>
#if defined(PSIBASE_VM_LLVM_AOT)
#include <psizam/native_artifact.hpp>
#include "psibase-native-aot-host.hpp"
#endif
#include <stdexcept>

namespace psibase
{
   std::shared_ptr<NativeAotCache> nativeAotCacheFromEnvironment()
   {
      if (const char* path = std::getenv("PSIBASE_NATIVE_AOT_CACHE"); path && *path)
         return std::make_shared<NativeAotCache>(path);
      return {};
   }

   NativeVMOptions::NativeVMOptions(const VMOptions& options,
                                    std::shared_ptr<NativeAotCache> artifacts)
       : VMOptions(options), nativeArtifacts(std::move(artifacts))
   {
      const char* only = std::getenv("PSIBASE_NATIVE_AOT_CACHE_ONLY");
      native_aot_cache_only = only && std::string_view(only) == "1";
      if (max_pages > 65536)
         throw std::runtime_error("native WASM policy exceeds memory32 page limit");
      if (max_stack_bytes > std::numeric_limits<std::int32_t>::max())
         throw std::runtime_error("native WASM stack policy exceeds signed code-offset limit");
   }

   std::array<std::uint8_t, 32> NativeVMOptions::native_aot_identity(
       std::span<const std::uint8_t> wasm, std::uint32_t maximumFunctionBytes,
       psizam::max_func_local_bytes_flags_t components, bool backtrace, bool byteStack) const
   {
#if defined(PSIBASE_VM_LLVM_AOT)
      return sha256(std::tuple{
          std::string("psibase-saved-native-aot-v1"), sha256(wasm.data(), wasm.size()),
          static_cast<const VMOptions&>(*this), maximumFunctionBytes, std::uint8_t(components),
          std::uint8_t(fp), std::uint8_t(memory_mode), std::uint8_t(checked_kind),
          gas_metering, limit_table_growth, defer_start, enable_exception_handling,
          enable_atomics, enable_relaxed_simd, enable_tail_calls, enable_simd,
          enable_bulk_memory, max_memory_section_elements, stack_usage_for_call,
          backtrace, byteStack, std::uint32_t(sizeof(void*)), std::uint64_t(::sysconf(_SC_PAGESIZE)),
          std::string(psizam::native_aot_build_identity()), std::string(PSIBASE_NATIVE_AOT_HOST_ID)});
#else
      return {};
#endif
   }

   std::vector<char> NativeVMOptions::load_native_aot(
       const std::array<std::uint8_t, 32>& identity) const
   {
      if (nativeArtifacts)
         if (auto artifact = nativeArtifacts->load(identity)) return std::move(*artifact);
      return {};
   }

   void NativeVMOptions::store_native_aot(const std::array<std::uint8_t, 32>& identity,
                                          std::span<const char> artifact) const noexcept
   {
      if (nativeArtifacts) nativeArtifacts->store(identity, artifact);
   }

   namespace
   {
      struct Reader
      {
         std::span<const std::uint8_t> bytes;
         std::span<const std::uint8_t> take(std::size_t size)
         {
            if (size > bytes.size())
               throw std::runtime_error("truncated native WASM declaration");
            auto result = bytes.first(size);
            bytes       = bytes.subspan(size);
            return result;
         }
         std::uint8_t  byte() { return take(1)[0]; }
         std::uint32_t u32()
         {
            std::uint32_t value = 0;
            for (unsigned shift = 0; shift < 35; shift += 7)
            {
               auto b = byte();
               if (shift == 28 && (b & 0xf0))
                  throw std::runtime_error("native WASM integer overflow");
               value |= std::uint32_t(b & 0x7f) << shift;
               if (!(b & 0x80))
                  return value;
            }
            throw std::runtime_error("invalid native WASM integer");
         }
         void name() { take(u32()); }
      };
   }  // namespace

   void validateNativeWasm(std::span<const std::uint8_t> code, const NativeVMOptions& options)
   {
      Reader                 input{code};
      constexpr std::uint8_t header[] = {0, 'a', 's', 'm', 1, 0, 0, 0};
      auto                   actual   = input.take(sizeof(header));
      if (!std::equal(actual.begin(), actual.end(), std::begin(header)))
         throw std::runtime_error("invalid native WASM header");
      while (!input.bytes.empty())
      {
         auto   id = input.byte();
         Reader section{input.take(input.u32())};
         if (id == 2)
         {
            auto count = section.u32();
            while (count--)
            {
               section.name();
               section.name();
               if (section.byte() != 0)
                  throw std::runtime_error("native WASM permits function imports only");
               section.u32();
            }
         }
         else if (id == 4 || id == 5)
         {
            auto count = section.u32();
            if (count > 1)
               throw std::runtime_error("native WASM permits one table and one memory");
            if (count)
            {
               if (id == 4 && section.byte() != 0x70)
                  throw std::runtime_error("native WASM requires a funcref table");
               auto flags = section.u32();
               if (flags > 1)
                  throw std::runtime_error(
                      "native WASM does not support shared or memory64 resources");
               auto initial = section.u32();
               if (initial > (id == 4 ? options.max_table_elements : options.max_pages))
                  throw std::runtime_error("native WASM initial resource exceeds chain policy");
               if (flags)
               {
                  auto maximum = section.u32();
                  if (maximum < initial || (id == 5 && maximum > 65536))
                     throw std::runtime_error("invalid native WASM resource maximum");
               }
            }
         }
         else if (id == 13)
         {
            throw std::runtime_error("native WASM exception tags are not supported");
         }
      }
   }

}  // namespace psibase
