#pragma once

#include <psibase/check.hpp>
#include <psio/reflect.hpp>

#include <cstdint>
#include <limits>
#include <string>
#include <string_view>

namespace psibase::http
{
   struct token_data
   {
      std::uint64_t exp;
      std::string   mode;  // "r", "rw"
   };
   PSIO_REFLECT(token_data, exp, mode);
   struct token_key
   {
     public:
      token_key(std::string_view k) : impl(k)
      {
         for (auto ch : k)
         {
            psibase::check(ch != '\r' && ch != '\n', "Unexpected newline in key");
         }
         psibase::check(k.size() <= std::numeric_limits<int>::max(), "Key too large");
      }
                  operator std::string_view() const { return impl; }
      const char* data() const { return impl.data(); }
      int         size() const { return static_cast<int>(impl.size()); }
      std::string str() const { return impl; }

     private:
      std::string impl;
   };
   token_data  decode_jwt(const token_key& k, std::string_view token);
   std::string encode_jwt(const token_key& k, const token_data&);
}  // namespace psibase::http
