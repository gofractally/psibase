#pragma once

#include <psibase/check.hpp>
#include <psio/fracpack.hpp>
#include <psio/view.hpp>

#include <string>
#include <string_view>

#include <simdjson.h>

namespace psibase
{
   /// A memo is a human readable string that is passed as an action argument.
   /// A memo must be valid UTF-8 and not longer than 80 bytes.
   struct Memo
   {
      static constexpr uint8_t maxBytes = 80;

      std::string contents;

      Memo(const std::string& s) : contents{s} { validate(s); }
      Memo() : Memo("") {}
      static bool validate(std::string_view str)
      {
         psibase::check(str.size() <= maxBytes, "Memo exceeds 80 bytes");
         psibase::check(simdjson::validate_utf8(str), "Memo must be valid UTF-8");
         return true;
      }
   };
   PSIO_REFLECT(Memo, contents);

   void from_json(Memo& s, auto& stream)
   {
      from_json(s.contents, stream);
      Memo::validate(s.contents);
   }

   void to_json(const Memo& s, auto& stream)
   {
      to_json(s.contents, stream);
   }

   inline std::string& clio_unwrap_packable(Memo& s)
   {
      return s.contents;
   }
   inline const std::string& clio_unwrap_packable(const Memo& s)
   {
      return s.contents;
   }

   inline bool clio_validate_packable(const Memo& str)
   {
      return Memo::validate(str.contents);
   }

   inline bool clio_validate_packable(psio::view<const Memo> str)
   {
      return Memo::validate(str.contents());
   }

}  // namespace psibase
