#include "services/user/DocSys.hpp"

#include <psibase/dispatch.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/commonErrors.hpp>

using namespace psibase;
using namespace UserService;
using namespace UserService::Errors;

using std::nullopt;
using std::optional;
using std::string;
using std::vector;

DocSys::DocSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().getIndex<0>().get(SingletonKey{});
      check(initRecord.has_value(), uninitialized);
   }
}

void DocSys::init()
{
   // Set initialized flag
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.getIndex<0>().get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // Register proxy
   to<SystemService::ProxySys>().registerServer(DocSys::service);
}

optional<HttpReply> DocSys::serveSys(HttpRequest request)
{
   if (auto result = serveContent(request, ServiceTables<WebContentTable>{getReceiver()}))
      return result;

   return nullopt;
}

void DocSys::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(std::move(path), std::move(contentType), std::move(content),
                ServiceTables<WebContentTable>{getReceiver()});
}

PSIBASE_DISPATCH(UserService::DocSys)
