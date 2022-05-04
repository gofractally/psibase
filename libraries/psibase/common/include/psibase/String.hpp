#pragma once

#include <psibase/check.hpp>
#include <psio/fracpack.hpp>
#include <string>
#include <string_view>

namespace psibase
{
   struct String
   {
      static constexpr uint8_t          MAX_BYTES     = 80;
      static constexpr std::string_view error_invalid = "Data exceeds psibase::String byte limit";

      std::string contents;

      String(const std::string& s) : contents{s} {}
      String() : String("") {}

      operator std::string() const { return contents; }

      static void fracpack_validate(const String& str)
      {
         psibase::check(str.contents.size() <= MAX_BYTES, error_invalid.data());
      }
   };
   PSIO_REFLECT(String, contents);

}  // namespace psibase
