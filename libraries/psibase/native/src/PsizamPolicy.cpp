#include <algorithm>
#include <limits>
#include <psibase/PsizamPolicy.hpp>
#include <psizam/types.hpp>
#include <stdexcept>

namespace psibase
{
   NativeVMOptions::NativeVMOptions(const VMOptions& options) : VMOptions(options)
   {
      if (max_pages > 65536)
         throw std::runtime_error("native WASM policy exceeds memory32 page limit");
      if (max_stack_bytes > std::numeric_limits<std::int32_t>::max())
         throw std::runtime_error("native WASM stack policy exceeds signed code-offset limit");
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

   void applyNativeTableLimit(psizam::module& module, const NativeVMOptions& options)
   {
      for (auto& table : module.tables)
      {
         table.limits.maximum = table.limits.flags
                                    ? std::min(table.limits.maximum, options.max_table_elements)
                                    : options.max_table_elements;
         table.limits.flags   = 1;
      }
   }
}  // namespace psibase
