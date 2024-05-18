#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/CommonApi.hpp>
#include <services/user/RTokens.hpp>
#include <services/user/Symbol.hpp>
#include <services/user/Tokens.hpp>
#include <string>
#include <vector>

using namespace UserService;
using namespace std;
using namespace psibase;

auto tokenService = Tokens::Tables{Tokens::service};
namespace TokenQueryTypes
{
   struct Balance
   {
      TID       id;
      Precision precision;
      SID       symbolId;
      uint64_t  balance;
   };
   PSIO_REFLECT(Balance, id, precision, symbolId, balance);

   struct Credit
   {
      TID           id;
      Precision     precision;
      SID           symbolId;
      uint64_t      balance;
      AccountNumber creditedTo;
   };
   PSIO_REFLECT(Credit, id, precision, symbolId, balance, creditedTo);

   struct Debit
   {
      TID           id;
      Precision     precision;
      SID           symbolId;
      uint64_t      balance;
      AccountNumber debitableFrom;
   };
   PSIO_REFLECT(Debit, id, precision, symbolId, balance, debitableFrom);

   struct AllBalances
   {
      vector<Balance> balances;
      vector<Credit>  credits;
      vector<Debit>   debits;
   };
   PSIO_REFLECT(AllBalances, balances, credits, debits);
}  // namespace TokenQueryTypes

using namespace TokenQueryTypes;
struct TokenQuery
{
   auto allBalances() const
   {  //
      return tokenService.open<BalanceTable>().getIndex<0>();
   }

   auto userBalances(AccountNumber user) const
   {
      AllBalances balances;

      auto tokenTypes = tokenService.open<TokenTable>().getIndex<0>();

      // Balances of this user
      auto balanceIdx = tokenService.open<BalanceTable>().getIndex<1>().subindex(user);
      for (auto balance : balanceIdx)
      {
         auto tokenOpt = tokenTypes.get(balance.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         balances.balances.push_back(Balance{balance.key.tokenId, tokenOpt->precision,
                                             tokenOpt->symbolId, balance.balance});
      }

      // Credit balances for this user
      auto creditIdx = tokenService.open<SharedBalanceTable>().getIndex<1>();
      for (auto credit : creditIdx)
      {
         auto tokenOpt = tokenTypes.get(credit.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         balances.credits.push_back(Credit{credit.key.tokenId, tokenOpt->precision,
                                           tokenOpt->symbolId, credit.balance, credit.key.debitor});
      }

      // Debit balances for this user
      auto debitIdx = tokenService.open<SharedBalanceTable>().getIndex<2>();
      for (auto debit : debitIdx)
      {
         auto tokenOpt = tokenTypes.get(debit.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         balances.debits.push_back(Debit{debit.key.tokenId, tokenOpt->precision, tokenOpt->symbolId,
                                         debit.balance, debit.key.creditor});
      }

      return balances;
   }

   auto sharedBalances() const
   {  //
      return tokenService.open<SharedBalanceTable>().getIndex<0>();
   }

   auto tokens() const
   {  //
      return tokenService.open<TokenTable>().getIndex<0>();
   }

   auto userConf(AccountNumber user, psibase::EnumElement flag) const
   {
      return to<Tokens>().getUserConf(user, flag);
   }
};

PSIO_REFLECT(TokenQuery,
             method(allBalances),
             method(userBalances, user),
             method(sharedBalances),
             method(tokens),
             method(userConf, user, flag))

optional<HttpReply> RTokens::serveSys(HttpRequest request)
{
   if (auto result = serveSimpleUI<Tokens, false>(request))
      return result;

   if (auto result = serveContent(request, ServiceTables<WebContentTable>{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, TokenQuery{}))
      return result;

   return nullopt;
}

void RTokens::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(std::move(path), std::move(contentType), std::move(content),
                ServiceTables<WebContentTable>{getReceiver()});
}

PSIBASE_DISPATCH(UserService::RTokens)
