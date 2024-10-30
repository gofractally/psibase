#pragma once

#include <psibase/psibase.hpp>
#include <psio/view.hpp>

namespace UserService
{
   struct Brotli
   {
      static constexpr auto service = psibase::AccountNumber("brotli");
      std::string           compress(const psio::view<std::string>& input);
      std::string           decompress(const psio::view<std::string>& input);
   };

   // clang-format off
   PSIO_REFLECT(Brotli,
      method(compress, input),
      method(decompress, input),
   );
   // clang-format on
}  // namespace UserService
