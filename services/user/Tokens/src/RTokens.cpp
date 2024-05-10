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

auto tokenService = QueryableService<Tokens::Tables, Tokens::Events>{Tokens::service};

struct UserBalanceRecord
{
   AccountNumber user;
   uint64_t      balance;
   uint8_t       precision;
   TID           token;
   SID           symbol;
};
PSIO_REFLECT(UserBalanceRecord, user, balance, precision, token, symbol);

struct TokenQuery
{
   auto allBalances() const
   {  //
      return tokenService.index<BalanceTable, 0>();
   }
   auto userBalances(AccountNumber user) const
   {  //
      vector<UserBalanceRecord> balances;
      for (auto tokenType : tokenService.index<TokenTable, 0>())
      {
         auto tid = tokenType.id;
         if (auto bal = tokenService.index<BalanceTable, 0>().get(BalanceKey{user, tid}))
         {
            balances.push_back(UserBalanceRecord{user, bal->balance, tokenType.precision.value, tid,
                                                 tokenType.symbolId});
         }
      }
      return balances;
   }

   auto sharedBalances() const
   {  //
      return tokenService.index<SharedBalanceTable, 0>();
   }

   auto tokens() const
   {  //
      return tokenService.index<TokenTable, 0>();
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
   if (auto result = servePackAction<Tokens>(request))
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
