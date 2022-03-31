#pragma once
#include <psio/reflect.hpp>

namespace psibase
{
   struct MethodNumber final
   {
      uint64_t value = 0;
      constexpr MethodNumber() : value(0) {}
      constexpr explicit MethodNumber(uint64_t v) : value(v) {}
      constexpr explicit MethodNumber(std::string_view s) : value(psio::detail::method_to_number(s))
      {
      }
      std::string str() const { return psio::detail::number_to_method(value); }
      friend bool operator==(const MethodNumber& a, const MethodNumber& b)
      {
         return a.value == b.value;
      }
      friend bool operator<(const MethodNumber& a, const MethodNumber& b)
      {
         return a.value < b.value;
      }
      friend bool operator!=(const MethodNumber& a, const MethodNumber& b)
      {
         return a.value != b.value;
      }
      //auto operator <=> (const MethodNumber&)const = default;
   };
   PSIO_REFLECT(MethodNumber, value)

}  // namespace psibase
inline constexpr psibase::MethodNumber operator""_m(const char* s, unsigned long)
{
   auto num = psibase::MethodNumber(s);
   if (not num.value)
   {
      std::abort();  // failed_to_compress_name
   }
   return num;
}
