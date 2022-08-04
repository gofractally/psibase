#include <contracts/system/AuthEcSys.hpp>
#include <contracts/system/InviteSys.hpp>

#include <contracts/system/VerifyEcSys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace system_contract
{
   void AuthEcSys::checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         print("auth_check\n");

      auto row = db.open<AuthTable>().getIndex<0>().get(action.sender);

      check(row.has_value(), "sender does not have a public key");

      auto expected = psio::convert_to_frac(row->pubkey);
      for (auto& claim : claims)
         if (claim.contract == VerifyEcSys::contract && claim.rawData == expected)
            return;
      abortMessage("transaction is not signed with key " + publicKeyToString(row->pubkey));
   }

   void AuthEcSys::newAccount(psibase::AccountNumber account, psibase::PublicKey payload)
   {
      check(getSender() == InviteSys::contract, "Only invite-sys can create a new account");
      check(payload.data.index() == 0, "only k1 currently supported");
      auto authTable = db.open<AuthTable>();
      check(!authTable.getIndex<0>().get(account).has_value(), "account already exists");

      authTable.put(AuthRecord{.account = account, .pubkey = payload});
   }

   void AuthEcSys::setKey(psibase::PublicKey key)
   {
      // TODO: charge resources? provide for free with all accounts?
      check(key.data.index() == 0, "only k1 currently supported");

      auto authTable = db.open<AuthTable>();
      authTable.put(AuthRecord{.account = getSender(), .pubkey = key});
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthEcSys)
