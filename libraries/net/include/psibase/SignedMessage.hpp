#pragma once

#include <psio/fracpack.hpp>
#include <vector>

namespace psibase::net
{
   template <typename Msg>
   struct SignedMessage
   {
      static constexpr auto type = Msg::type;

      psio::shared_view_ptr<Msg> data;

      std::vector<char> signature;
      PSIO_REFLECT(SignedMessage, definitionWillNotChange(), data, signature)
      std::string to_string() const { return data->unpack().to_string(); }
   };

   template <typename T>
   concept NeedsSignature = requires(const T& t) { t.signer; };
}  // namespace psibase::net
