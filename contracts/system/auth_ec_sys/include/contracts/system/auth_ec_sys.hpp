#pragma once

#include <eosio/crypto.hpp>
#include <psibase/intrinsic.hpp>
#include <psibase/native_tables.hpp>
#include <psibase/actor.hpp>

namespace eosio {
   PSIO_REFLECT( webauthn_public_key, key, user_presence, rpid )
}

namespace system_contract
{
   using psibase::AccountNumber;
   using psibase::Claim;
   using psibase::Action;
   using psio::const_view;
   using PublicKey = eosio::public_key;

   class auth_ec_sys : public psibase::contract {
      public:
      static constexpr psibase::AccountNumber contract = AccountNumber("auth-ec-sys");

      // sets the key, and if not exist, creates account
      uint8_t setKey( AccountNumber num, PublicKey key );
      uint8_t authCheck( const_view<Action> act, const_view<std::vector<Claim>> claims );
   };

   PSIO_REFLECT_INTERFACE( auth_ec_sys,
                           (setKey, 0, account, key),
                           (authCheck, 1, action, claims ) )

}  // namespace system_contract
