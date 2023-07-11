#include <services/system/AccountSys.hpp>

#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/TransactionSys.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   void AccountSys::init()
   {
      Tables tables{getReceiver()};
      auto   statusTable  = tables.open<AccountSysStatusTable>();
      auto   statusIndex  = statusTable.getIndex<0>();
      auto   accountTable = tables.open<AccountTable>();
      check(!statusIndex.get(std::tuple{}), "already started");

      uint32_t totalAccounts = 0;
      auto     codeIndex     = psibase::TableIndex<psibase::CodeRow, std::tuple<>>{
          psibase::CodeRow::db, psio::convert_to_key(codePrefix()), false};
      if constexpr (enable_print)
         writeConsole("initial accounts: ");
      for (auto it = codeIndex.begin(); it != codeIndex.end(); ++it)
      {
         auto code = *it;
         if constexpr (enable_print)
         {
            writeConsole(code.codeNum.str());
            writeConsole(" ");
         }
         accountTable.put({
             .accountNum  = code.codeNum,
             .authService = AuthAnySys::service,
         });
         ++totalAccounts;
      }

      statusTable.put({.totalAccounts = totalAccounts});
   }

   void AccountSys::newAccount(AccountNumber name, AccountNumber authService, bool requireNew)
   {
      Tables tables{getReceiver()};
      auto   statusTable  = tables.open<AccountSysStatusTable>();
      auto   statusIndex  = statusTable.getIndex<0>();
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();

      auto status = statusIndex.get(std::tuple{});
      check(status.has_value(), "not started");

      auto sender = getSender();
      check(sender == service || sender == inviteService, "Unauthorized account creation");

      if (enable_print)
      {
         writeConsole("new acc: ");
         writeConsole(name.str());
         writeConsole("auth con: ");
         writeConsole(authService.str());
      }

      check(name.value, "invalid account name");

      // Check compression roundtrip
      check(AccountNumber{name.str()}.value, "invalid account name");

      if (accountIndex.get(name))
      {
         if (requireNew)
            abortMessage("account already exists");
         return;
      }
      check(accountIndex.get(authService) != std::nullopt, "unknown auth service");

      Account account{
          .accountNum  = name,
          .authService = authService,
      };
      accountTable.put(account);

      ++status->totalAccounts;
      statusTable.put(*status);
   }

   void AccountSys::setAuthServ(psibase::AccountNumber authService)
   {
      Tables tables{getReceiver()};
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();
      auto   account      = accountIndex.get((getSender()));
      check(account.has_value(), "account does not exist");

      to<AuthInterface>(authService).canAuthUserSys(getSender());

      account->authService = authService;
      accountTable.put(*account);
   }

   bool AccountSys::exists(AccountNumber name)
   {
      Tables tables{getReceiver()};
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();
      return accountIndex.get(name) != std::nullopt;
   }

   void AccountSys::billCpu(AccountNumber name, std::chrono::nanoseconds amount)
   {
      Tables tables{getReceiver()};

      auto accountTable = tables.open<AccountTable>();
      auto accountIndex = accountTable.getIndex<0>();
      auto row          = accountIndex.get(name);
      check(!!row, "account does not exist");
      if (row->resourceBalance)
      {
         row->resourceBalance->billCpu(amount);
         accountTable.put(*row);
      }
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AccountSys)
