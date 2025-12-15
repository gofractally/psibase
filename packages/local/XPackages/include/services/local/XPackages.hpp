#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/package.hpp>

namespace LocalService
{
   struct LocalPackage
   {
      std::string                         name;
      std::string                         version;
      std::string                         description;
      std::vector<psibase::PackageRef>    depends;
      std::vector<psibase::AccountNumber> accounts;
      psibase::Checksum256                sha256;
   };
   PSIO_REFLECT(LocalPackage, name, version, description, depends, accounts, sha256)
   using LocalPackagesTable = psibase::Table<LocalPackage, &LocalPackage::name>;
   PSIO_REFLECT_TYPENAME(LocalPackagesTable)

   struct PendingLocalPackage
   {
      std::string                         name;
      std::string                         version;
      std::string                         description;
      std::vector<psibase::PackageRef>    depends;
      std::vector<psibase::AccountNumber> accounts;
      psibase::Checksum256                sha256;
      bool                                removing = false;

      using ByName = psibase::CompositeKey<&PendingLocalPackage::name,
                                           &PendingLocalPackage::version,
                                           &PendingLocalPackage::sha256>;
   };
   PSIO_REFLECT(PendingLocalPackage,
                name,
                version,
                description,
                depends,
                accounts,
                sha256,
                removing)
   using PendingLocalPackagesTable =
       psibase::Table<PendingLocalPackage, PendingLocalPackage::ByName{}>;
   PSIO_REFLECT_TYPENAME(PendingLocalPackagesTable)

   struct XPackages : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-packages"};
      using Subjective = psibase::SubjectiveTables<LocalPackagesTable, PendingLocalPackagesTable>;
      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        request,
                                                 std::optional<std::int32_t> socket);
   };
   PSIO_REFLECT(XPackages, method(serveSys, request))
   PSIBASE_REFLECT_TABLES(XPackages, XPackages::Subjective)
}  // namespace LocalService
