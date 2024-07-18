#include "services/user/Sites.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <services/system/HttpServer.hpp>

using namespace psibase;

namespace SystemService
{
   namespace
   {
      struct Query
      {
         AccountNumber service;

         auto content() const
         {
            return Sites::Tables{service}.open<SitesContentTable>().getIndex<0>();
         }
      };
      PSIO_REFLECT(  //
          Query,
          method(content))
   }  // namespace

   std::optional<HttpReply> Sites::serveSys(HttpRequest request)
   {
      check(request.host.size() > request.rootHost.size(),
            "Request host [" + request.host + "] is not valid.");

      std::string_view accountName{request.host.data(),
                                   request.host.size() - request.rootHost.size() - 1};
      auto             account = AccountNumber(accountName);

      if (account == Sites::service)
      {
         if (auto result = psibase::serveActionTemplates<Sites>(request))
            return result;

         if (auto result = psibase::servePackAction<Sites>(request))
            return result;

         if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
            return result;
      }

      Tables tables{getReceiver()};
      if (request.method == "GET")
      {
         auto index  = tables.open<SitesContentTable>().getIndex<0>();
         auto target = request.target;
         auto pos    = target.find('?');
         if (pos != target.npos)
            target.resize(pos);
         auto content = index.get(SitesContentKey{account, target});
         if (!content)
         {
            if (target.ends_with('/'))
               content = index.get(SitesContentKey{account, target + "index.html"});
            else
               content = index.get(SitesContentKey{account, target + "/index.html"});
         }
         if (!content && target == "/")
         {
            content =
                index.get(SitesContentKey{getReceiver(), "/default-profile/default-profile.html"});
         }
         if (!content && target.starts_with("/default-profile/"))
         {
            content = index.get(SitesContentKey{getReceiver(), target});
         }
         if (content)
         {
            return HttpReply{
                .contentType = content->contentType,
                .body        = content->content,
            };
         }
      }

      return std::nullopt;
   }  // Sites::serveSys

   void Sites::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      Tables tables{getReceiver()};
      auto   table = tables.template open<SitesContentTable>();

      check(path.starts_with('/'), "Path doesn't begin with /");

      auto regServer = HttpServer::Tables(HttpServer::service)
                           .open<SystemService::RegServTable>()
                           .get(getSender());
      check(!regServer.has_value(),
            getSender().str() +
                " already has a registered http server. Uploaded artifact would be overshadowed.");

      SitesContentRow row{
          .account     = getSender(),
          .path        = std::move(path),
          .contentType = std::move(contentType),
          .content     = std::move(content),
      };
      table.put(row);
   }

   void Sites::removeSys(std::string path)
   {
      Tables tables{getReceiver()};
      auto   table = tables.template open<SitesContentTable>();
      table.erase(SitesContentKey{getSender(), path});
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Sites)
