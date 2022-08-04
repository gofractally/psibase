#include <contracts/system/AccountSys.hpp>

#include <contracts/system/TransactionSys.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace system_contract
{
   struct Status
   {
      uint32_t totalAccounts = 0;

      std::tuple<> key() const { return {}; }
   };
   PSIO_REFLECT(Status, totalAccounts)
   using StatusTable = Table<Status, &Status::key>;

   struct SingletonKey
   {
   };
   PSIO_REFLECT(SingletonKey);
   struct CreatorRecord
   {
      SingletonKey  key;
      AccountNumber accountCreator;
   };
   PSIO_REFLECT(CreatorRecord, key, accountCreator);
   using CreatorTable = Table<CreatorRecord, &CreatorRecord::key>;

   using Tables = ContractTables<StatusTable, CreatorTable>;

   void AccountSys::startup()
   {
      Tables tables{getReceiver()};
      auto   statusTable = tables.open<StatusTable>();
      auto   statusIndex = statusTable.getIndex<0>();
      check(!statusIndex.get(std::tuple{}), "already started");

      uint32_t totalAccounts = 0;
      auto     accountIndex  = psibase::TableIndex<psibase::AccountRow, std::tuple<>>{
               psibase::AccountRow::db, psio::convert_to_key(psibase::accountTable), false};
      for (auto it = accountIndex.begin(); it != accountIndex.end(); ++it)
         ++totalAccounts;

      statusTable.put({.totalAccounts = totalAccounts});
   }

   // TODO: limit who can use -sys suffix
   // TODO: verify name round-trips through strings
   void AccountSys::newAccount(AccountNumber name, AccountNumber authContract, bool requireNew)
   {
      Tables tables{getReceiver()};
      auto   statusTable = tables.open<StatusTable>();
      auto   statusIndex = statusTable.getIndex<0>();
      auto   status      = statusIndex.get(std::tuple{});
      check(status.has_value(), "not started");

      auto creatorTable = Tables{getReceiver()}.open<CreatorTable>();
      auto creator      = creatorTable.getIndex<0>().get(SingletonKey{});
      if (creator.has_value())
      {
         check(
             (*creator).accountCreator == getSender(),
             "Only " + (*creator).accountCreator.str() + " is authorized to create new accounts.");
      }

      if (enable_print)
      {
         writeConsole("new acc: ");
         writeConsole(name.str());
         writeConsole("auth con: ");
         writeConsole(authContract.str());
      }

      check(name.value, "invalid account name");
      if (exists(name))
      {
         if (requireNew)
            abortMessage("account already exists");
         return;
      }
      check(exists(authContract), "unknown auth contract");

      ++status->totalAccounts;
      AccountRow account{
          .num          = name,
          .authContract = authContract,
          .flags        = 0,
      };
      statusTable.put(*status);
      kvPut(account.db, account.key(), account);
   }

   void AccountSys::setAuthCntr(psibase::AccountNumber authContract)
   {
      auto account = kvGet<AccountRow>(AccountRow::db, accountKey(getSender()));
      check(account.has_value(), "account does not exist");
      account->authContract = authContract;
      kvPut(AccountRow::db, account->key(), *account);
   }

   bool AccountSys::exists(AccountNumber num)
   {
      return !!kvGet<AccountRow>(AccountRow::db, accountKey(num));
   }

   void AccountSys::setCreator(psibase::AccountNumber creator)
   {
      check(getSender() == AccountSys::contract,
            "Only " + AccountSys::contract.str() + " can set the creator account");

      Tables{getReceiver()}.open<CreatorTable>().put(
          CreatorRecord{.key = SingletonKey{}, .accountCreator = creator});
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::AccountSys)
