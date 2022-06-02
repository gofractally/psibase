#include <contracts/system/auth_ec_sys.hpp>

#include <contracts/system/account_sys.hpp>
#include <contracts/system/verify_ec_sys.hpp>
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
         if (claim.contract == verify_ec_sys::contract && claim.rawData == expected)
            return;
      abortMessage("no matching claim found");
   }

   void AuthEcSys::setKey(psibase::AccountNumber account, psibase::PublicKey key)
   {
      check(getSender() == account, "wrong sender");
      auth_row row{account, key};
      kvPut(row.key(), row);
   }

   psibase::AccountNumber AuthEcSys::createAccount(psibase::AccountNumber name,
                                                   psibase::PublicKey     publicKey)
   {
      if (enable_print)
         writeConsole("account_sys::create_account");
      psibase::Actor<account_sys> asys(getReceiver(), account_sys::contract);
      asys.newAccount(name, getReceiver(), true);
      auth_row row{AccountNumber{name}, publicKey};
      kvPut(row.key(), row);
      return name;
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AuthEcSys)
