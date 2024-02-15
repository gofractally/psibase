#pragma once

#include <psibase/psibase.hpp>

namespace UserService
{
   struct PackageRef
   {
      std::string name;
      std::string version;
   };
   PSIO_REFLECT(PackageRef, name, version)

   struct PackageMeta
   {
      std::string                         name;
      std::string                         version;
      std::string                         description;
      std::vector<PackageRef>             depends;
      std::vector<psibase::AccountNumber> accounts;
   };
   PSIO_REFLECT(PackageMeta, name, version, description, depends, accounts)

   struct PackageKey
   {
      std::string            name;
      psibase::AccountNumber owner;
   };
   PSIO_REFLECT(PackageKey, name, owner)

   struct InstalledPackage
   {
      std::string                         name;
      std::string                         version;
      std::string                         description;
      std::vector<PackageRef>             depends;
      std::vector<psibase::AccountNumber> accounts;
      psibase::AccountNumber              owner;

      auto byName() const { return PackageKey(name, owner); }
   };
   PSIO_REFLECT(InstalledPackage, name, description, depends, accounts, owner)

   using InstalledPackageTable = psibase::Table<InstalledPackage, &InstalledPackage::byName>;

   struct PackageSys : psibase::Service<PackageSys>
   {
      static constexpr auto service = psibase::AccountNumber{"package-sys"};
      using Tables                  = psibase::ServiceTables<InstalledPackageTable>;
      // This should be the last action run when installing a package
      void postinstall(PackageMeta package);
   };
   PSIO_REFLECT(PackageSys, method(postinstall, package))

}  // namespace UserService
