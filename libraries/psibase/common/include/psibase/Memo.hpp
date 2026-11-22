#pragma once

#include <psibase/check.hpp>
#include <psio/reflect.hpp>

#include <string>
#include <string_view>

#include <rapidjson/encodings.h>
#include <rapidjson/memorystream.h>

namespace psibase
{

   /// A memo is a human readable string that is passed as an action argument.
   /// A memo must be valid UTF-8 and not longer than 80 bytes.
   ///
   /// A memo is its text wherever it is serialized (`transparent()`): the
   /// same bytes, key and JSON as the string. A reader that checks its
   /// input rejects text that is not a memo (`invariant(wellFormed)`).
   struct Memo
   {
      static constexpr uint8_t maxBytes = 80;

      std::string contents;

      Memo(const char* s) : contents{s} { validate(s); }
      Memo(const std::string& s) : contents{s} { validate(s); }
      Memo() : Memo("") {}

      /// Why `str` is not a memo; null if it is one.
      static const char* invalid(std::string_view str) noexcept
      {
         if (str.size() > maxBytes)
            return "Memo exceeds 80 bytes";
         struct NullStream
         {
            char*  PutBegin() { return 0; }
            void   Put(char) {}
            void   Flush() {}
            size_t PutEnd(char*) { return 0; }
         };
         rapidjson::MemoryStream in(str.data(), str.size());
         NullStream              out;
         while (in.Tell() != str.size())
         {
            if (!rapidjson::UTF8<>::Validate(in, out))
               return "Memo must be valid UTF-8";
         }
         return nullptr;
      }
      /// Aborts unless `str` is a memo.
      static bool validate(std::string_view str)
      {
         if (const char* reason = invalid(str))
            psibase::check(false, reason);
         return true;
      }
      static psio::codec_status wellFormed(const Memo& memo) noexcept
      {
         if (const char* reason = invalid(memo.contents))
            return psio::codec_fail(reason, 0, "Memo");
         return psio::codec_ok();
      }
      PSIO_REFLECT(Memo, transparent(), invariant(wellFormed), contents)
   };

}  // namespace psibase
