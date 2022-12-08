#pragma once

#include <psio/fracpack.hpp>
#include <vector>

namespace psibase::net
{
   template <typename Msg>
   struct SignedMessage
   {
      static constexpr auto type = Msg::type;

      Msg data;

      std::vector<char> signature;
      PSIO_REFLECT(SignedMessage, definitionWillNotChange(), data, signature)
      std::string to_string() const { return data.to_string(); }
   };

   template <typename T>
   concept NeedsSignature = requires(const T& t)
   {
      {
         t.signer()
         } -> std::same_as<Claim>;
   };
}  // namespace psibase::net
