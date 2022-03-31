#pragma once
#include <psibase/name.hpp>

namespace psibase
{
   struct AccountNumber final
   {
      uint64_t value = 0;
      constexpr AccountNumber() : value(0) {}
      constexpr explicit AccountNumber(uint64_t v) : value(v) {}
      constexpr explicit AccountNumber(std::string_view s) : value(name_to_number(s)) {}
      std::string str() const { return number_to_name(value); }
      friend bool operator==(const AccountNumber& a, const AccountNumber& b)
      {
         return a.value == b.value;
      }
      friend bool operator<(const AccountNumber& a, const AccountNumber& b)
      {
         return a.value < b.value;
      }
      friend bool operator!=(const AccountNumber& a, const AccountNumber& b)
      {
         return a.value != b.value;
      }
      //auto operator <=> (const AccountNumber&)const = default;
   };
   PSIO_REFLECT(AccountNumber, value)

   // TODO: remove
   using account_num = AccountNumber;

   template <typename S>
   void to_key(const AccountNumber& k, S& s)
   {
      s.write(&k.value, sizeof(k.value));
   }

}  // namespace psibase
inline constexpr psibase::AccountNumber operator""_a(const char* s, unsigned long)
{
   auto num = psibase::AccountNumber(s);
   if (not num.value)
   {
      std::abort();  // failed_to_compress_name
   }
   return num;
}
