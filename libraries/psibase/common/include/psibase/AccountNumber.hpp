#pragma once
#include <compare>
#include <psibase/name.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   struct AccountNumber final
   {
      uint64_t value = 0;
      constexpr AccountNumber() : value(0) {}
      constexpr explicit AccountNumber(uint64_t v) : value(v) {}
      constexpr explicit AccountNumber(std::string_view s) : value(name_to_number(s)) {}
      std::string str() const { return number_to_name(value); }
      auto        operator<=>(const AccountNumber&) const = default;
   };
   PSIO_REFLECT(AccountNumber, value)
   EOSIO_REFLECT(AccountNumber, value)  //Todo - remove when kv table uses PSIO

   // TODO: remove
   using account_num = AccountNumber;

   template <typename S>
   void to_json(const AccountNumber& n, S& s)
   {
      to_json(n.str(), s);
   }

   template <typename S>
   void from_json(AccountNumber& result, S& stream)
   {
      result = AccountNumber{stream.get_string()};
   }

   // TODO: This special rule causes kv sort order and AccountNumber::operator<=>()
   //       to disagree. This will cause nasty headaches for someone.
   // Fix:  Drop this overload and uncomment the byte swap in execution_context.
   template <typename S>
   void to_key(const AccountNumber& k, S& s)
   {
      s.write(&k.value, sizeof(k.value));
   }

}  // namespace psibase

// TODO: move to psibase::literals (inline namespace)
inline constexpr psibase::AccountNumber operator""_a(const char* s, unsigned long)
{
   auto num = psibase::AccountNumber(s);
   if (not num.value)
   {
      std::abort();  // failed_to_compress_name
   }
   return num;
}
