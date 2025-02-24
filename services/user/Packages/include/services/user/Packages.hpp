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

   struct TransactionOrder
   {
      psibase::AccountNumber owner;
      psibase::Checksum256   id;
      std::uint32_t          index;

      auto key() const { return std::tuple(owner, id); }
   };
   PSIO_REFLECT(TransactionOrder, owner, id, index)

   using InstalledPackageTable = psibase::Table<InstalledPackage, &InstalledPackage::byName>;
   using PackageManifestTable  = psibase::Table<PackageManifest, &PackageManifest::byName>;
   using TransactionOrderTable = psibase::Table<TransactionOrder, &TransactionOrder::key>;

   struct Packages : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"packages"};
      using Tables                  = psibase::
          ServiceTables<InstalledPackageTable, PackageManifestTable, TransactionOrderTable>;
      // This should be the last action run when installing a package
      void postinstall(PackageMeta package, std::vector<char> manifest);

      /// Used to ensure that the transactions that install packages
      /// are executed in order.
      ///
      /// - id: A unique id that identifies the group of transactions
      /// - index: Counter that starts at 0 and must increment by one with each call
      void checkOrder(psibase::Checksum256 id, std::uint32_t index);
      void removeOrder(psibase::Checksum256 id);
   };
   PSIO_REFLECT(Packages,
                method(postinstall, package, manifest),
                method(checkOrder, id, index),
                method(removeOrder, id))

}  // namespace UserService
