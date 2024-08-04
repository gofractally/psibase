#include <map>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/Events.hpp>
#include <services/user/Nft.hpp>
#include <services/user/REvents.hpp>
#include <services/user/Tokens.hpp>
#include <services/user/Webmail.hpp>
#include <sstream>

using namespace UserService;
using namespace psibase;
using namespace std;

namespace
{
   HttpRequest makeQuery(const HttpRequest& in, std::string_view s)
   {
      return {.host        = in.host,
              .rootHost    = in.rootHost,
              .method      = "POST",
              .target      = "/sql",
              .contentType = "application/sql",
              .body        = std::vector(s.begin(), s.end())};
   }

   auto validateUser = [](const std::string& user)
   {
      auto acc = AccountNumber{user};
      if (acc.str() != user)
         return false;

      return to<SystemService::Accounts>().exists(acc);
   };

   map<string, string> parseQuery(const string& query)
   {
      map<string, string> params;
      istringstream       queryStream(query);
      string              pair;

      while (getline(queryStream, pair, '&'))
      {
         size_t pos = pair.find('=');
         if (pos != string::npos)
         {
            string key   = pair.substr(0, pos);
            string value = pair.substr(pos + 1);
            params[key]  = value;
         }
      }
      return params;
   }
}  // namespace

Webmail::Webmail(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != "init"_m && m != "storeSys"_m)
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), Errors::uninitialized);
   }
}

void Webmail::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), Errors::alreadyInit);
   initTable.put(InitializedRecord{});

   // Configure manualDebit for self on Token and NFT
   to<Tokens>().setUserConf("manualDebit"_m, true);
   to<Nft>().setUserConf("manualDebit"_m, true);

   // Register http server
   to<SystemService::HttpServer>().registerServer(Webmail::service);

   // Events/indices
   to<EventIndex>().setSchema(ServiceSchema::make<Webmail>());
   to<EventIndex>().addIndex(DbId::historyEvent, Webmail::service, "sent"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Webmail::service, "sent"_m, 1);
}

void Webmail::send(psibase::AccountNumber receiver,
                   const std::string&     subject,
                   const std::string&     body)
{
   check(to<SystemService::Accounts>().exists(receiver), "target receiver account does not exist");
   emit().history().sent(getSender(), receiver, subject, body);
}

// Supported REST query:
//    `GET /messages?sender=alice&receiver=bob`
// Either sender or receiver (or both) must be specified.
optional<HttpReply> serveRestApi(const HttpRequest& request)
{
   if (request.method == "GET")
   {
      if (!request.target.starts_with("/messages"))
      {
         return nullopt;
      }

      size_t queryStart = request.target.find('?');
      if (queryStart == string::npos)
      {
         return nullopt;
      }

      string query  = request.target.substr(queryStart + 1);
      auto   params = parseQuery(query);

      string s, r;
      if (params.count("sender") != 0)
      {
         auto user = params.at("sender");
         if (!validateUser(user))
         {
            return nullopt;
         }
         s = "sender = '" + user + "'";
      }
      if (params.count("receiver") != 0)
      {
         auto user = params.at("receiver");
         if (!validateUser(user))
         {
            return nullopt;
         }
         r = "receiver = '" + user + "'";
      }
      if (s.empty() && r.empty())
      {
         return nullopt;
      }

      string where = "WHERE " + s;
      if (!s.empty() && !r.empty())
      {
         where += " AND " + r;
      }
      else if (!r.empty())
      {
         where = "WHERE " + r;
      }

      return to<REvents>().serveSys(makeQuery(
          request, "SELECT * FROM \"history.webmail.sent\" " + where + " ORDER BY ROWID"));
   }
   return nullopt;
}

optional<HttpReply> Webmail::serveSys(HttpRequest request)
{
   if (auto result = serveContent(request, Tables{}))
      return result;
   if (auto result = serveSimpleUI<Webmail, true>(request))
      return result;
   if (auto result = serveRestApi(request))
      return result;

   return nullopt;
}

void Webmail::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(std::move(path), std::move(contentType), std::move(content), Tables{});
}

PSIBASE_DISPATCH(UserService::Webmail)
