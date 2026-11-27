#pragma once

// A passkey guest for tests: a secp256k1 key and the guest session that
// transact+1 gives for it (POST /guest-login).
#include <psibase/DefaultTestChain.hpp>
#include <psibase/crypto.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/Transact.hpp>

#include <chrono>
#include <format>
#include <string>
#include <vector>

namespace TestGuest
{
   struct GuestLoginRequest
   {
      std::vector<char> key;
      std::int64_t      exp;
      std::vector<char> sig;
      PSIO_REFLECT(GuestLoginRequest, key, exp, sig)
   };
   struct GuestLoginReply
   {
      std::string  access_token;
      std::string  token_type;
      std::string  guest;
      std::int64_t exp;
      PSIO_REFLECT(GuestLoginReply, access_token, token_type, guest, exp)
   };

   struct Guest
   {
      SystemService::AuthSig::PrivateKeyInfo       priv;
      SystemService::AuthSig::SubjectPublicKeyInfo pub;
      // The guest id, and the bearer token of the session
      std::string id;
      std::string token;

      std::vector<char> keyBytes() const { return {pub.data.begin(), pub.data.end()}; }

      std::vector<char> sign(std::string_view message) const
      {
         auto sig = SystemService::AuthSig::sign(priv, psibase::sha256(message.data(), message.size()));
         return {sig.begin(), sig.end()};
      }
   };

   inline Guest login(psibase::TestChain& t)
   {
      Guest guest{.priv = SystemService::AuthSig::PrivateKeyInfo::create("secp256k1")};
      guest.pub = getSubjectPublicKeyInfo(guest.priv);
      auto exp  = std::chrono::duration_cast<std::chrono::seconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count() +
                  60;
      // The tester's requests are for hosts under psibase.io
      auto reply  = t.post<GuestLoginReply>(
          SystemService::Transact::service, "/guest-login",
          psibase::JsonBody{GuestLoginRequest{
              guest.keyBytes(), exp, guest.sign(std::format("psibase guest login\npsibase.io\n{}", exp))}});
      guest.id    = reply.guest;
      guest.token = reply.access_token;
      return guest;
   }
}  // namespace TestGuest
