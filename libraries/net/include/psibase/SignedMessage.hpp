#pragma once

#include <psio/pssz.hpp>
#include <psio/buffer.hpp>
#include <psio/pssz_view.hpp>
#include <vector>

namespace psibase::net
{
   template <typename Msg>
   struct SignedMessage
   {
      static constexpr auto type = Msg::type;

      SignedMessage() = default;
      SignedMessage(psio::shared_pssz<Msg> data, std::vector<char> signature = {})
          : data(std::move(data)), signature(std::move(signature))
      {
      }
      // Packs the message
      SignedMessage(const Msg& msg, std::vector<char> signature = {})
          : data(msg), signature(std::move(signature))
      {
      }

      // The message as it was signed and as it is sent
      psio::shared_pssz<Msg> data;

      std::vector<char> signature;
      PSIO_REFLECT(SignedMessage, definitionWillNotChange(), data, signature)
      std::string to_string() const { return data->unpack().to_string(); }
   };

   template <typename T>
   concept NeedsSignature = requires(const T& t) { t.signer; };
}  // namespace psibase::net
