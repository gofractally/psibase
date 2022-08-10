#pragma once
#include <psibase/Contract.hpp>
#include <psibase/name.hpp>
#include <vector>

namespace system_contract
{
   class InviteSys : public psibase::Contract<InviteSys>
   {
     public:
      static constexpr auto contract     = psibase::AccountNumber("invite-sys");
      static constexpr auto payerAccount = psibase::AccountNumber("invite-payer-sys");

      void acceptInvite(psibase::AccountNumber name,
                        psibase::AccountNumber authContract,
                        psibase::PublicKey     payload);
   };

   PSIO_REFLECT(InviteSys,  //
                method(acceptInvite, name, authContract, payload)
                //
   )
}  // namespace system_contract
