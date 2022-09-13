#include "services/user/PsiSpaceSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
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
            return PsiSpaceSys::Tables{service}.open<PsiSpaceContentTable>().getIndex<0>();
         }
      };
      PSIO_REFLECT(  //
          Query,
          method(content))
   }  // namespace

   std::optional<HttpReply> PsiSpaceSys::serveSys(HttpRequest request)
   {
      check(request.host.size() > request.rootHost.size(), "oops");

      Tables           tables{getReceiver()};
      std::string_view accountName{request.host.data(),
                                   request.host.size() - request.rootHost.size() - 1};
      auto             account = AccountNumber(accountName);

      if (account == PsiSpaceSys::service)
      {
         if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
            return result;
         if (auto result = serveSimpleUI<PsiSpaceSys, true>(request))
            return result;
      }

      if (request.method == "GET")
      {
         auto index  = tables.open<PsiSpaceContentTable>().getIndex<0>();
         auto target = request.target;
         auto pos    = target.find('?');
         if (pos != target.npos)
            target.resize(pos);
         auto content = index.get(PsiSpaceContentKey{account, target});
         if (!content)
         {
            if (target.ends_with('/'))
               content = index.get(PsiSpaceContentKey{account, target + "index.html"});
            else
               content = index.get(PsiSpaceContentKey{account, target + "/index.html"});
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
   }  // PsiSpaceSys::serveSys

   void PsiSpaceSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      Tables tables{getReceiver()};
      auto   table = tables.template open<PsiSpaceContentTable>();

      check(path.starts_with('/'), "Path doesn't begin with /");
      PsiSpaceContentRow row{
          .account     = getSender(),
          .path        = std::move(path),
          .contentType = std::move(contentType),
          .content     = std::move(content),
      };
      table.put(row);
   }

   void PsiSpaceSys::removeSys(std::string path)
   {
      Tables tables{getReceiver()};
      auto   table = tables.template open<PsiSpaceContentTable>();
      table.erase(PsiSpaceContentKey{getSender(), path});
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::PsiSpaceSys)
