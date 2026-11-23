#pragma once

// TEMPORARY: removed when psio1 is deleted.
//
// A type PSIO declares transparent() over a bounded member
// (`PSIO_REFLECT(Memo, transparent(), attr(contents, utf8 | max<80>))`) is
// that bounded type in PSIO's formats. This library has no bounded types:
// it packs and reads the member, and checks the bound where it validates
// (unpacking, validating packed data, reading JSON). A value outside the
// bound aborts with the message psibase's Memo has always aborted with:
// "<Type> exceeds <N> bytes" or "<Type> must be valid UTF-8".

#include <psio/max_size.hpp>
#include <psio/reflect.hpp>
#include <psio/wrappers.hpp>
#include <psio1/check.hpp>

#include <string>
#include <string_view>

namespace psio1
{
   template <typename T>
   inline constexpr bool canonical_bounded_wrapper_v = []
   {
      if constexpr (::psio::is_transparent_v<T>)
         return !::psio::has_invariant_v<T> && ::psio::transparent_member_checked_v<T>;
      else
         return false;
   }();

   template <typename T>
      requires canonical_bounded_wrapper_v<T>
   void canonical_check_bounded(const T& value)
   {
      static const std::string tooLong = std::string(::psio::reflect<T>::name) + " exceeds " +
                                         std::to_string(*::psio::max_encoded_size<T>()) + " bytes";
      static const std::string notUtf8 =
          std::string(::psio::reflect<T>::name) + " must be valid UTF-8";
      if (auto status = ::psio::check_transparent_member(value, tooLong.c_str(), "frac");
          !status.ok())
      {
         if (status.error().what == std::string_view{tooLong})
            abort_error(tooLong.c_str());
         abort_error(notUtf8.c_str());
      }
   }
}  // namespace psio1
