#pragma once

#include <psibase/SignedMessage.hpp>
#include <psibase/block.hpp>

#include <psio/fracpack.hpp>
#include <psio/stream.hpp>

#include <vector>

namespace psibase::net
{
   template <typename T, typename Derived>
   concept has_recv = requires(Derived& d, const T& msg) { d.consensus().recv(0, msg); };

   template <typename Derived>
   struct message_serializer
   {
      template <typename Msg>
      static std::vector<char> serialize_unsigned_message(const Msg& msg)
      {
         static_assert(Msg::type < 128);
         std::vector<char> result(psio::fracpack_size(msg) + 1);
         result[0] = Msg::type;
         psio::fast_buf_stream s(result.data() + 1, result.size() - 1);
         psio::to_frac(msg, s);
         return result;
      }
      template <NeedsSignature Msg>
      SignedMessage<Msg> sign_message(const Msg& msg)
      {
         auto  raw   = serialize_unsigned_message(msg);
         Claim claim = msg.signer;
         auto  sig   = static_cast<Derived*>(this)->chain().sign({raw.data(), raw.size()}, claim);
         return {msg, sig};
      }
      template <typename Msg>
      std::vector<char> serialize_signed_message(const Msg& msg)
      {
         // TODO: avoid serializing the message twice
         return serialize_unsigned_message(sign_message(msg));
      }
      template <typename Msg>
      auto serialize_message(const Msg& msg)
      {
         return serialize_unsigned_message(msg);
      }
      template <NeedsSignature Msg>
      auto serialize_message(const Msg& msg)
      {
         return serialize_signed_message(msg);
      }
      auto serialize_message(const std::vector<char>& msg) { return msg; }
   };
}  // namespace psibase::net
