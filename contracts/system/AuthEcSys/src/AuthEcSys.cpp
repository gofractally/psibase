#include <contracts/system/AuthEcSys.hpp>

#include <contracts/system/VerifyEcSys.hpp>
#include <psibase/crypto.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/print.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace system_contract
{
   // TODO: switch to table wrapper
   using table_num                       = uint32_t;
   static constexpr table_num auth_table = 1;

   inline auto auth_key(AccountNumber account)
   {
      return std::tuple{AuthEcSys::contract, auth_table, account};
   }
   struct auth_row
   {
      AccountNumber account;
      PublicKey     pubkey;

      auto key() { return auth_key(account); }
   };
   PSIO_REFLECT(auth_row, account, pubkey)

   void AuthEcSys::checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims)
   {
      if (enable_print)
         print("auth_check\n");
      auto row = kvGet<auth_row>(auth_key(action.sender));
      check(!!row, "sender does not have a public key");
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
      auth_row row{getSender(), key};
      kvPut(row.key(), row);
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthEcSys)
