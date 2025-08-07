#pragma once

#include <psibase/psibase.hpp>
#include <psio/view.hpp>
#include <vector>

namespace UserService
{
   /// The Brotli service is used to decompress content encoded with the Brotli algorithm.
   ///
   /// It implements the `Sites` DecompressorInterface
   struct Brotli
   {
      static constexpr auto service = psibase::AccountNumber("brotli-codec");

      /// Decompresses a Brotli-compressed byte array
      std::vector<char> decompress(const std::vector<char>& content);
   };

   PSIO_REFLECT(Brotli, method(decompress, content), );
}  // namespace UserService