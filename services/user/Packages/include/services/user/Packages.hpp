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
   PSIO_REFLECT(InstalledPackage, name, version, description, depends, accounts, owner)

   struct PackageDataFile
   {
      psibase::AccountNumber account;
      psibase::AccountNumber service;
      std::string            filename;
   };
   PSIO_REFLECT(PackageDataFile, account, service, filename)

   struct PackageManifest
   {
      std::string            name;
      psibase::AccountNumber owner;
      // gzipped json vector<PackageDataFile>
      std::vector<char> data;

      auto byName() const { return std::tuple(name, owner); }
   };
   PSIO_REFLECT(PackageManifest, name, owner, data)

   using InstalledPackageTable = psibase::Table<InstalledPackage, &InstalledPackage::byName>;
   using PackageManifestTable  = psibase::Table<PackageManifest, &PackageManifest::byName>;

   struct Packages : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"packages"};
      using Tables = psibase::ServiceTables<InstalledPackageTable, PackageManifestTable>;
      // This should be the last action run when installing a package
      void postinstall(PackageMeta package, std::vector<char> manifest);
   };
   PSIO_REFLECT(Packages, method(postinstall, package, manifest))

}  // namespace UserService
