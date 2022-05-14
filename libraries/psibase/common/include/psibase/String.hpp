#pragma once

#include <psibase/check.hpp>
#include <psio/fracpack.hpp>
#include <string>
#include <string_view>

namespace psibase
{
   // TODO: rename. This isn't just a string; it's a string with an unusual constraint.
   // TODO: fracpack doesn't enforce constraint yet
   // TODO: from_json doesn't enforce constraint yet
   // TODO: json form is odd
   // TODO: consider removing. I'm (Todd) not a fan of types who's sole reason is to
   //       enforce a constraint. If a function has constraints, then it should be the
   //       one to enforce them. Potential helper for those functions:
   //       `checkMemoLength(string_view memo)`.
   struct String
   {
      static constexpr uint8_t          MAX_BYTES = 80;  // TODO: rename. ONLY_MACROS_ARE_LIKE_THIS.
      static constexpr std::string_view error_invalid = "Data exceeds psibase::String byte limit";

      std::string contents;

      String(const std::string& s) : contents{s} {}
      String() : String("") {}

      static void fracpack_validate(const String& str)
      {
         psibase::check(str.contents.size() <= MAX_BYTES, error_invalid.data());
      }
   };
   PSIO_REFLECT(String, contents);

}  // namespace psibase
