#include <services/system/Accounts.hpp>

#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/Transact.hpp>

static constexpr bool enable_print = false;

using namespace psibase;

namespace SystemService
{
   void Accounts::init()
   {
      Tables tables{getReceiver()};
      auto   statusTable  = tables.open<AccountsStatusTable>();
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
             .authService = AuthAny::service,
         });
         ++totalAccounts;
      }

      statusTable.put({.totalAccounts = totalAccounts});
   }

   void Accounts::newAccount(AccountNumber name, AccountNumber authService, bool requireNew)
   {
      Tables tables{getReceiver()};
      auto   statusTable  = tables.open<AccountsStatusTable>();
      auto   statusIndex  = statusTable.getIndex<0>();
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();

      auto status = statusIndex.get(std::tuple{});
      check(status.has_value(), "not started");

      auto sender = getSender();
      check(sender == service || sender == inviteService, "unauthorized account creation");

      std::string strName = name.str();
      if (enable_print)
      {
         writeConsole("new acc: ");
         writeConsole(strName);
         writeConsole("auth con: ");
         writeConsole(authService.str());
      }

      check(name.value, "invalid account name");
      check(strName.back() != '-', "account name must not end in a hyphen");
      if (sender != service)
      {
         check(!strName.starts_with("x-"),
               "The 'x-' account prefix is reserved for infrastructure providers");
      }

      // Check compression roundtrip
      check(AccountNumber{strName}.value, "invalid account name");

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

   void Accounts::setAuthServ(psibase::AccountNumber authService)
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

   bool Accounts::exists(AccountNumber name)
   {
      Tables tables{getReceiver()};
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();
      return accountIndex.get(name) != std::nullopt;
   }

   void Accounts::billCpu(AccountNumber name, std::chrono::nanoseconds amount)
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

PSIBASE_DISPATCH(SystemService::Accounts)
