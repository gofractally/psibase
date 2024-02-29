#include <services/user/PackageSys.hpp>
#include <services/user/RPackageSys.hpp>

using Tables = psibase::ServiceTables<psibase::WebContentTable>;

namespace UserService
{
   struct Query
   {
      auto installed() const
      {
         return PackageSys::Tables(PackageSys::service).open<InstalledPackageTable>().getIndex<0>();
      }
   };
   PSIO_REFLECT(  //
       Query,
       method(installed))

   std::optional<psibase::HttpReply> RPackageSys::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      if (auto result = psibase::serveContent(request, Tables{psibase::getReceiver()}))
         return result;
      return std::nullopt;
   }

   void RPackageSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{psibase::getReceiver()});
   }
}  // namespace UserService

PSIBASE_DISPATCH(UserService::RPackageSys)
