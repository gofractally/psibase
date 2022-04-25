#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace psidb
{

   using key_type     = std::string_view;
   using page_id      = std::uint32_t;
   using version_type = std::uint64_t;

   constexpr std::size_t page_size    = 4096;
   constexpr std::size_t min_key_size = 16;

   enum class page_type : std::uint8_t
   {
      node,
      leaf
   };

   struct page_header
   {
      page_type    type;
      page_id      prev;
      version_type version;
   };
   static_assert(sizeof(page_header) == 16);

}  // namespace psidb
