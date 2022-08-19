#include "contracts/system/PsiSpaceSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>

using namespace psibase;

namespace system_contract
{
   namespace
   {
      struct Query
      {
         AccountNumber contract;

         auto content() const
         {
            return PsiSpaceSys::Tables{contract}.open<PsiSpaceContentTable>().getIndex<0>();
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

      if (account == PsiSpaceSys::contract)
      {
         if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
            return result;
         if (auto result = serveSimpleUI<PsiSpaceSys, true>(request))
            return result;
      }

      if (request.method == "GET")
      {
         auto index   = tables.open<PsiSpaceContentTable>().getIndex<0>();
         auto content = index.get(PsiSpaceContentKey{account, request.target});
         if (!content)
         {
            if (request.target.ends_with('/'))
               content = index.get(PsiSpaceContentKey{account, request.target + "index.html"});
            else
               content = index.get(PsiSpaceContentKey{account, request.target + "/index.html"});
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

      PsiSpaceContentRow row{
          .account     = getSender(),
          .path        = std::move(path),
          .contentType = std::move(contentType),
          .content     = std::move(content),
      };
      table.put(row);
   }
}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::PsiSpaceSys)
