#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/Email.hpp>
#include <services/user/Events.hpp>
#include <services/user/Nft.hpp>
#include <services/user/REvents.hpp>
#include <services/user/Tokens.hpp>

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

   auto json_reply = [](const auto& obj)
   {
      auto json = psio::convert_to_json(obj);
      return HttpReply{
          .contentType = "application/json",
          .body        = {json.begin(), json.end()},
      };
   };

   auto extractUser = [](const std::string& target) -> optional<string>
   {
      auto pos = target.find("?user=");
      if (pos == string::npos)
         return nullopt;

      auto user = target.substr(pos + 6);
      if (user.length() == 0)
         return nullopt;

      return user;
   };
}  // namespace

Email::Email(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != "init"_m && m != "storeSys"_m)
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), Errors::uninitialized);
   }
}

void Email::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), Errors::alreadyInit);
   initTable.put(InitializedRecord{});

   // Configure manualDebit for self on Token and NFT
   to<Tokens>().setUserConf("manualDebit"_m, true);
   to<Nft>().setUserConf("manualDebit"_m, true);

   // Register http server
   to<SystemService::HttpServer>().registerServer(Email::service);

   // Events/indices
   to<EventIndex>().setSchema(ServiceSchema::make<Email>());
   to<EventIndex>().addIndex(DbId::historyEvent, Email::service, "sent"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Email::service, "sent"_m, 1);
}

void Email::send(psibase::AccountNumber recipient,
                 const std::string&     subject,
                 const std::string&     body)
{
   check(to<SystemService::Accounts>().exists(recipient),
         "target recipient account does not exist");
   emit().history().sent(getSender(), recipient, subject, body);
}

// Supported REST queries:
// GET /messages/sender?user=alice
// GET /messages/recipient?user=alice
optional<HttpReply> serveRestApi(const HttpRequest& request)
{
   if (request.method == "GET")
   {
      optional<string> property;
      if (request.target.find("/messages/sender") != string::npos)
      {
         property = "sender";
      }
      else if (request.target.find("/messages/recipient") != string::npos)
      {
         property = "recipient";
      }
      if (property)
      {
         auto user = extractUser(request.target);
         if (user == nullopt)
            return nullopt;

         writeConsole("SELECT * FROM \"history.email.sent\" WHERE " + property.value() + " = '" +
                      user.value() + "' ORDER BY ROWID");

         return to<REvents>().serveSys(
             makeQuery(request, "SELECT * FROM \"history.email.sent\" WHERE " + property.value() +
                                    " = '" + user.value() + "' ORDER BY ROWID"));
      }
   }
   return nullopt;
}

optional<HttpReply> Email::serveSys(HttpRequest request)
{
   if (auto result = serveContent(request, Tables{}))
      return result;
   if (auto result = serveSimpleUI<Email, true>(request))
      return result;
   if (auto result = serveRestApi(request))
      return result;

   return nullopt;
}

void Email::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(std::move(path), std::move(contentType), std::move(content), Tables{});
}

PSIBASE_DISPATCH(UserService::Email)
