#include <services/user/PackageSys.hpp>

namespace UserService
{

   void PackageSys::postinstall(InstalledPackage package)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      auto table = Tables(psibase::getReceiver()).open<InstalledPackageTable>();
      table.put(package);
   }
}  // namespace UserService

PSIBASE_DISPATCH(UserService::PackageSys)
