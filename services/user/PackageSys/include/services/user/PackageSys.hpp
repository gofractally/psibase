#pragma once

#include <psibase/psibase.hpp>

namespace UserService
{

   struct InstalledPackage
   {
      std::string                         name;
      std::vector<std::string>            depends;
      std::vector<psibase::AccountNumber> accounts;
   };
   PSIO_REFLECT(InstalledPackage, name, depends, accounts)

   using InstalledPackageTable = psibase::Table<InstalledPackage, &InstalledPackage::name>;

   struct PackageSys : psibase::Service<PackageSys>
   {
      static constexpr auto service = psibase::AccountNumber{"package-sys"};
      using Tables                  = psibase::ServiceTables<InstalledPackageTable>;
      // This should be the last action run when installing a package
      void postinstall(InstalledPackage package);
   };
   PSIO_REFLECT(PackageSys, method(postinstall, package))

}  // namespace UserService
