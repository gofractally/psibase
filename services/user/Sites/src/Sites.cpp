#include "services/user/Sites.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serveSchema.hpp>
#include <psibase/serveSimpleUI.hpp>

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
      PSIO_REFLECT(Query, method(content))

      bool isSubdomain(const psibase::HttpRequest& req)
      {
         return req.host.size() > req.rootHost.size() + 1  //
                && req.host.ends_with(req.rootHost)        //
                && req.host[req.host.size() - req.rootHost.size() - 1] == '.';
      }

      AccountNumber getTargetService(const HttpRequest& req)
      {
         std::string serviceName;

         // Path reserved across all subdomains
         if (req.target.starts_with("/common"))
            serviceName = "common-api";

         // subdomain
         else if (isSubdomain(req))
            serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

         // root domain
         else
            serviceName = "homepage";

         return AccountNumber(serviceName);
      }
   }  // namespace

   std::optional<HttpReply> Sites::serveSys(HttpRequest request)
   {
      if (request.host.size() < request.rootHost.size())
      {
         check(false, "request host invalid: \"" + request.host + "\"");
      }

      auto account = getTargetService(request);
      if (account == Sites::service)
      {
         if (auto result = psibase::serveActionTemplates<Sites>(request))
            return result;

         if (auto result = psibase::servePackAction<Sites>(request))
            return result;

         if (auto result = psibase::serveSchema<Sites>(request))
            return result;

         if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
            return result;

         if (auto result = psibase::serveSimpleUI<Sites, true>(request))
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

         auto siteConfig = tables.open<SiteConfigTable>().get(account);
         if (siteConfig && siteConfig->spa)
         {
            if (target.ends_with(".html") || target == "/" || target.find('.') == target.npos)
            {
               target = "/";
            }
         }

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
      auto   table = tables.open<SitesContentTable>();
      table.erase(SitesContentKey{getSender(), path});
   }

   void Sites::enableSpa(bool enable)
   {
      auto table = Tables{}.open<SiteConfigTable>();
      auto row   = table.get(getSender())
                     .value_or(SiteConfigRow{
                         .account = getSender(),
                         .spa     = enable,
                     });
      row.spa = enable;
      table.put(row);
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Sites)
