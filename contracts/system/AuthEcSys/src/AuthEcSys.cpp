#include <contracts/system/AuthEcSys.hpp>

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

      auto row = db.open<AuthTable_t>().getIndex<0>().get(action.sender);

      check(row.has_value(), "sender does not have a public key");

      auto expected = psio::convert_to_frac(row->pubkey);
      for (auto& claim : claims)
         if (claim.contract == VerifyEcSys::contract && claim.rawData == expected)
            return;
      abortMessage("transaction is not signed with key " + publicKeyToString(row->pubkey));
   }

   void AuthEcSys::setKey(psibase::PublicKey key)
   {
      // TODO: charge resources? provide for free with all accounts?
      check(key.data.index() == 0, "only k1 currently supported");

      auto authTable = db.open<AuthTable_t>();
      authTable.put(AuthRecord{.account = getSender(), .pubkey = key});
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthEcSys)
