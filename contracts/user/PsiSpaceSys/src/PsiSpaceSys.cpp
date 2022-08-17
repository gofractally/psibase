#include "contracts/system/PsiSpaceSys.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveSimpleUI.hpp>

using namespace psibase;

namespace system_contract
{
   std::optional<HttpReply> PsiSpaceSys::serveSys(HttpRequest request)
   {
      check(request.host.size() > request.rootHost.size(), "oops");

      Tables           tables{getReceiver()};
      std::string_view accountName{request.host.data(),
                                   request.host.size() - request.rootHost.size() - 1};
      auto             account = AccountNumber(accountName);

      if (account == PsiSpaceSys::contract)
      {
         if (auto result = serveSimpleUI<PsiSpaceSys, true>(request))
            return result;
      }

      if (request.method == "GET")
      {
         auto index = tables.template open<PsiSpaceContentTable>().template getIndex<0>();
         if (auto content = index.get(std::tie(account, request.target)))
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
