#pragma once

#include <psibase/intrinsic.hpp>
#include <psibase/actor.hpp>
#include <psibase/native_tables.hpp>

namespace system_contract
{
   using namespace psibase;
   using psio::const_view;

   class auth_fake_sys : public psibase::contract {
      public:
      static constexpr psibase::AccountNumber contract = AccountNumber("auth-fake-sys");

      // sets the key, and if not exist, creates account
      uint8_t authCheck( const_view<Action> act, const_view<std::vector<Claim>> claims );
   };

   PSIO_REFLECT_INTERFACE( auth_fake_sys,
                           (authCheck, 0, action, claims ) )

}  // namespace system_contract
