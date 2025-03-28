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

      using ByName = psibase::CompositeKey<&InstalledPackage::name, &InstalledPackage::owner>;
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

      using ByName = psibase::CompositeKey<&PackageManifest::name, &PackageManifest::owner>;
   };
   PSIO_REFLECT(PackageManifest, name, owner, data)

   struct InstalledSchema
   {
      psibase::AccountNumber account;
      psibase::ServiceSchema schema;
   };
   PSIO_REFLECT(InstalledSchema, account, schema)

   using InstalledSchemaTable = psibase::Table<InstalledSchema, &InstalledSchema::account>;
   PSIO_REFLECT_TYPENAME(InstalledSchemaTable)

   struct TransactionOrder
   {
      psibase::AccountNumber owner;
      std::uint64_t          id;
      std::uint32_t          index;

      using Key = psibase::CompositeKey<&TransactionOrder::owner, &TransactionOrder::id>;
   };
   PSIO_REFLECT(TransactionOrder, owner, id, index)

   using InstalledPackageTable = psibase::Table<InstalledPackage, InstalledPackage::ByName{}>;
   PSIO_REFLECT_TYPENAME(InstalledPackageTable)
   using PackageManifestTable = psibase::Table<PackageManifest, PackageManifest::ByName{}>;
   PSIO_REFLECT_TYPENAME(PackageManifestTable)
   using TransactionOrderTable = psibase::Table<TransactionOrder, TransactionOrder::Key{}>;
   PSIO_REFLECT_TYPENAME(TransactionOrderTable)

   struct Packages : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"packages"};
      using Tables                  = psibase::ServiceTables<InstalledPackageTable,
                                                             PackageManifestTable,
                                                             TransactionOrderTable,
                                                             InstalledSchemaTable>;
      // This should be the last action run when installing a package
      void postinstall(PackageMeta package, std::vector<char> manifest);
      void setSchema(psibase::ServiceSchema schema);

      /// Used to ensure that the transactions that install packages
      /// are executed in order.
      ///
      /// - id: A unique id that identifies the group of transactions
      /// - index: Counter that starts at 0 and must increment by one with each call
      void checkOrder(std::uint64_t id, std::uint32_t index);
      void removeOrder(std::uint64_t id);
   };
   PSIO_REFLECT(Packages,
                method(postinstall, package, manifest),
                method(setSchema, account, schema),
                method(checkOrder, id, index),
                method(removeOrder, id))
   PSIBASE_REFLECT_TABLES(Packages, Packages::Tables)

}  // namespace UserService
