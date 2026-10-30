#include <services/system/Accounts.hpp>

#include <psibase/AccountNumber.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/Transact.hpp>

static constexpr bool        enable_print               = false;
static constexpr std::size_t MIN_ALLOWED_ACCOUNT_LENGTH = 8;

using namespace psibase;

namespace SystemService
{
   void Accounts::init()
   {
      Tables tables{getReceiver()};
      auto   statusTable  = tables.open<AccountsStatusTable>();
      auto   statusIndex  = statusTable.getIndex<0>();
      auto   accountTable = tables.open<AccountTable>();

      if (statusIndex.get(std::tuple{}))
         return;

      uint32_t totalAccounts = 0;
      auto     codeTable     = Native::tables(KvMode::read).open<CodeTable>();
      if constexpr (enable_print)
         writeConsole("initial accounts: ");
      for (auto code : codeTable.getIndex<0>())
      {
         if constexpr (enable_print)
         {
            writeConsole(code.codeNum.str());
            writeConsole(" ");
         }
         accountTable.put({
             .accountNum  = code.codeNum,
             .authService = AuthDelegate::service,
         });
         ++totalAccounts;
      }

      statusTable.put({.totalAccounts = totalAccounts});
   }

   namespace
   {
      std::vector<psibase::AccountNumber> preapprovedAccounts = {};
   }

   void Accounts::preapproveAcc(AccountNumber name)
   {
      if (name.subaccount())
      {
         if (getSender() != name.base())
         {
            abortMessage(std::format("subaccount {} can only be created by {}", name.str(),
                                     name.base().str()));
         }
      }
      else if (name.str().starts_with("x-"))
      {
         check(getSender() == getReceiver(),
               "The 'x-' account prefix is reserved for infrastructure providers");
      }
      else
      {
         check(getSender() == getReceiver() || getSender() == AccountNumber("namemarket"),
               "unauthorized");
      }

      preapprovedAccounts.push_back(name);
   }

   bool Accounts::newAccount(AccountNumber name, AccountNumber authService, NewAccountMode mode)
   {
      check(mode == NewAccountMode::requireNew || mode == NewAccountMode::matchExisting ||
                mode == NewAccountMode::keepExisting,
            "invalid mode");

      Tables tables{getReceiver()};
      auto   statusTable  = tables.open<AccountsStatusTable>();
      auto   statusIndex  = statusTable.getIndex<0>();
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();

      auto status = statusIndex.get(std::tuple{});
      check(status.has_value(), "not started");

      std::string strName = name.str();
      if (enable_print)
      {
         writeConsole("new acc: ");
         writeConsole(strName);
         writeConsole("auth srv: ");
         writeConsole(authService.str());
      }

      check(name.value, "invalid account name");
      check(strName.back() != '-', "account name must not end in a hyphen");
      if (!std::ranges::contains(preapprovedAccounts, name))
      {
         if (name.subaccount())
         {
            check(getSender() == name.base(),
                  "Subaccounts can only be created by the primary account");
         }
         else if (getSender() != service)
         {
            check(!strName.starts_with("x-"),
                  "The 'x-' account prefix is reserved for infrastructure providers");
            check(strName.length() >= MIN_ALLOWED_ACCOUNT_LENGTH,
                  "account name must be at least " + std::to_string(MIN_ALLOWED_ACCOUNT_LENGTH) +
                      " characters: " + strName);
         }
      }

      // Check compression roundtrip
      check(AccountNumber{strName}.value, "invalid account name");

      if (auto existing = accountIndex.get(name))
      {
         if (mode == NewAccountMode::requireNew ||
             mode == NewAccountMode::matchExisting && existing->authService != authService)
            abortMessage("account already exists");
         return false;
      }
      check(accountIndex.get(authService) != std::nullopt, "unknown auth service");

      Account account{
          .accountNum   = name,
          .authService  = authService,
          .authSequence = 0,
      };
      accountTable.put(account);

      ++status->totalAccounts;
      statusTable.put(*status);
      return true;
   }

   void Accounts::assignAuth(AccountNumber name, AccountNumber authService)
   {
      auto accountTable = open<AccountTable>();
      auto account      = accountTable.getIndex<0>().get(name);
      check(account.has_value(), "account " + name.str() + " does not exist");

      to<AuthInterface>(authService).canAuthUserSys(name);

      account->authService = authService;
      ++account->authSequence;
      accountTable.put(*account);
   }

   void Accounts::setAuthServ(psibase::AccountNumber authService)
   {
      assignAuth(getSender(), authService);
   }

   std::optional<Account> Accounts::getAccount(AccountNumber name)
   {
      Tables tables{getReceiver(), KvMode::read};
      auto   accountTable = tables.open<AccountTable>();
      auto   accountIndex = accountTable.getIndex<0>();
      return accountIndex.get(name);
   }

   psibase::AccountNumber Accounts::getAuthOf(psibase::AccountNumber account)
   {
      auto accountRow = getAccount(account);
      check(accountRow.has_value(), "account " + account.str() + " does not exist");
      return accountRow->authService;
   }

   void Accounts::incAuthSeq(psibase::AccountNumber name)
   {
      auto accountTable = open<AccountTable>();
      auto accountRow   = accountTable.getIndex<0>().get(name);
      if (accountRow && accountRow->authService == getSender())
      {
         ++accountRow->authSequence;
         accountTable.put(*accountRow);
      }
   }

   bool Accounts::exists(AccountNumber name)
   {
      return getAccount(name) != std::nullopt;
   }

   void Accounts::freeze(std::vector<AccountNumber> accounts, std::optional<std::string> memo)
   {
      check(getSender() == service, "unauthorized");
      auto frozen = open<FrozenTable>();
      auto rows   = open<AccountTable>();
      for (auto account : accounts)
      {
         AccountNumber previous;
         {
            auto row = rows.getIndex<0>().get(account);
            check(row.has_value(), "account " + account.str() + " does not exist");
            previous = row->authService;
         }
         if (!frozen.get(account))
         {
            frozen.put(FrozenAccount{.account = account, .authService = previous});
            assignAuth(account, authNoneService);
            emit().history().froze(account, memo);
         }
      }
   }

   void Accounts::unfreeze(std::vector<AccountNumber> accounts, std::optional<std::string> memo)
   {
      check(getSender() == service, "unauthorized");
      auto frozen = open<FrozenTable>();
      for (auto account : accounts)
      {
         if (auto saved = frozen.get(account))
         {
            assignAuth(account, saved->authService);
            frozen.remove(*saved);
            emit().history().unfroze(account, memo);
         }
      }
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Accounts)
