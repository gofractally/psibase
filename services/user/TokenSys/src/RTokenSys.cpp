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

template <typename Tables>
struct StateQuery
{
   AccountNumber service;

   template <typename TableType, int Idx>
   auto index()
   {
      return Tables{service}.template open<TableType>().template getIndex<Idx>();
   }
};

template <typename Service, typename TableType>
struct EventLink
{
   using Tables         = typename Service::Tables;
   using RecordType     = typename TableType::value_type;
   using PrimaryKeyType = typename TableType::key_type;
   using HistoryEvents  = typename Service::Events::History;

   psibase::AccountNumber serviceName;
   uint64_t RecordType::*eventHead;
   string_view           previousEventFieldName;

   EventLink(psibase::AccountNumber serviceName,
             uint64_t RecordType::*eventHead,
             string_view           previousEventFieldName)
       : serviceName(serviceName),
         eventHead(eventHead),
         previousEventFieldName(previousEventFieldName)
   {
   }

   uint64_t getEventHead(PrimaryKeyType key)
   {
      auto idx = StateQuery<Tables>{serviceName}.template index<TableType, 0>();

      uint64_t eventId = 0;
      if (auto record = idx.get(key))
      {
         eventId = (*record).*eventHead;
      }

      return eventId;
   }

   auto makeConnection(PrimaryKeyType key, auto first, auto after)
   {
      auto eventId = getEventHead(key);

      return makeEventConnection<HistoryEvents>(DbId::historyEvent, eventId, serviceName,
                                                previousEventFieldName, first, after);
   }
};

EventLink<TokenSys, TokenHolderTable> transactionEvents(getReceiver(),
                                                        &TokenHolderRecord::lastHistoryEvent,
                                                        "prevEvent");

struct TokenQuery
{
   static constexpr auto stateQuery = []() { return StateQuery<TokenSys::Tables>{getReceiver()}; };
   static constexpr auto eventQuery = []() { return EventQuery<TokenSys::Events>{getReceiver()}; };

   auto balances() const
   {  //

      return stateQuery().index<BalanceTable, 0>();
   }

   auto sharedBalances() const
   {  //
      return stateQuery().index<SharedBalanceTable, 0>();
   }

   auto events() const
   {  //
      return eventQuery();
   }

   auto holderEvents(AccountNumber           holder,
                     optional<uint32_t>      first,
                     const optional<string>& after) const
   {
      return transactionEvents.makeConnection(holder, first, after);
   }
};
PSIO_REFLECT(TokenQuery,
             method(balances),
             method(sharedBalances),
             method(events),
             method(holderEvents, holder, first, after))

optional<HttpReply> RTokenSys::serveSys(HttpRequest request)
{
   // if (auto result = to<SystemService::CommonSys>().serveCommon(request).unpack())
   //    return result;

   if (auto result = servePackAction<TokenSys>(request))
      return result;

   if (auto result = serveContent(request, ServiceTables<WebContentTable>{getReceiver()}))
      return result;

   if (auto result = _serveRestEndpoints(request))
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

struct AccountBalance
{
   psibase::AccountNumber account;
   TID                    token;
   psibase::AccountNumber symbol;
   uint8_t                precision;
   uint64_t               balance;
};
PSIO_REFLECT(AccountBalance, account, token, symbol, precision, balance);

std::optional<HttpReply> RTokenSys::_serveRestEndpoints(HttpRequest& request)
{
   auto to_json_reply = [](const auto& obj)
   {
      auto json = psio::convert_to_json(obj);
      return HttpReply{
          .contentType = "application/json",
          .body        = {json.begin(), json.end()},
      };
   };

   if (request.method == "GET")
   {
      if (request.target == "/simple" || request.target == "/action_templates")
      {
         if (request.target == "/simple")
         {
            request.target = "/";
         }
         if (auto result = serveSimpleUI<TokenSys, true>(request))
            return result;
      }
      if (request.target.starts_with("/api/getTokenTypes"))
      {
         auto parameters = request.target.substr(string("/api/getTokenTypes").size());
         check(parameters.find('/') == string::npos, "invalid request");

         TokenSys::Tables db{getReceiver()};
         auto             idx = db.open<TokenTable>().getIndex<0>();

         std::vector<UserService::TokenRecord> allTokens;
         for (auto itr = idx.begin(); itr != idx.end(); ++itr)
         {
            allTokens.push_back(*itr);
         }
         return to_json_reply(allTokens);
      }
      if (request.target.starts_with("/api/balances/"))
      {
         auto user = request.target.substr(string("/api/balances/").size());
         check(user.find('/') == string::npos, "invalid user " + user);
         psibase::AccountNumber acc(string_view{user});

         TokenSys::Tables db{getReceiver()};
         auto             idx = db.open<TokenTable>().getIndex<0>();
         check(idx.begin() != idx.end(), "No tokens");

         auto                        balIdx = db.open<BalanceTable>().getIndex<0>();
         std::vector<AccountBalance> balances;
         TID                         tokenId = 1;
         for (auto itr = idx.begin(); itr != idx.end(); ++itr)
         {
            auto balance = to<TokenSys>().getBalance(tokenId, acc);
            auto token   = to<TokenSys>().getToken(balance.key.tokenId);

            if (balance.balance != 0)
            {
               balances.push_back(AccountBalance{
                   .account   = balance.key.account,
                   .token     = balance.key.tokenId,
                   .symbol    = token.symbolId,
                   .precision = token.precision.value,
                   .balance   = balance.balance,
               });
            }

            ++tokenId;
         }

         return to_json_reply(balances);
      }
      if (request.target.starts_with("/api/getUserConf/"))
      {
         auto user_and_flag = request.target.substr(string("/api/getUserConf/").size());
         auto delimiter = user_and_flag.find('/');
         check(delimiter != string::npos, "invalid user or flag " + user_and_flag);
         auto user = user_and_flag.substr(0, delimiter);
         auto flag = user_and_flag.substr(delimiter + 1, user_and_flag.size());
         psibase::AccountNumber acc(string_view{user});
         auto tokService = to<TokenSys>();
         auto manualDebit = tokService.getUserConf(acc, flag);
         return to_json(manualDebit);
      }
   }

   return std::nullopt;
}

PSIBASE_DISPATCH(UserService::RTokenSys)