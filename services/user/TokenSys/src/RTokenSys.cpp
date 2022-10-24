#include <psibase/dispatch.hpp>
#include <psibase/print.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/CommonSys.hpp>
#include <services/user/RTokenSys.hpp>
#include <services/user/SymbolSys.hpp>
#include <services/user/TokenSys.hpp>
#include <string>
#include <vector>

using namespace UserService;
using namespace std;
using namespace psibase;

auto tokenSys = QueryableService<TokenSys::Tables, TokenSys::Events>{TokenSys::service};

struct TokenQuery
{
   auto balances() const
   {  //
      return tokenSys.index<BalanceTable, 0>();
   }

   auto sharedBalances() const
   {  //
      return tokenSys.index<SharedBalanceTable, 0>();
   }

   auto tokenTypes() const
   {  //
      return tokenSys.index<TokenTable, 0>();
   }

   auto getUserConf(AccountNumber user, psibase::NamedBit flag) const
   {
      return to<TokenSys>().getUserConf(user, flag);
   }

   auto events() const
   {  //
      return tokenSys.allEvents();
   }

   auto userEvents(AccountNumber           user,
                   optional<uint32_t>      first,
                   const optional<string>& after) const
   {
      return tokenSys.eventIndex<TokenSys::UserEvents>(user, first, after);
   }
};
PSIO_REFLECT(TokenQuery,
             method(balances),
             method(sharedBalances),
             method(tokenTypes),
             method(getUserConf, user, flag),
             method(events),
             method(userEvents, user, first, after))

optional<HttpReply> RTokenSys::serveSys(HttpRequest request)
{
   if (auto result = servePackAction<TokenSys>(request))
      return result;

   if (auto result = serveContent(request, ServiceTables<WebContentTable>{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, TokenQuery{}))
      return result;

   return nullopt;
}

void RTokenSys::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content),
                ServiceTables<WebContentTable>{getReceiver()});
}

PSIBASE_DISPATCH(UserService::RTokenSys)