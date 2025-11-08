#pragma once

#include <map>
#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/block.hpp>
#include <psibase/crypto.hpp>
#include <psibase/zip.hpp>
#include <psio/from_json.hpp>
#include <psio/reflect.hpp>
#include <services/user/Packages.hpp>
#include <span>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

namespace psibase
{
   using UserService::PackageMeta;
   using UserService::PackageRef;

   struct PackageInfo
   {
      std::string                name;
      std::string                version;
      std::string                description;
      std::vector<PackageRef>    depends;
      std::vector<AccountNumber> accounts;
      Checksum256                sha256;
      std::string                file;
   };
   PSIO_REFLECT(PackageInfo, name, version, description, depends, accounts, sha256, file)

   std::weak_ordering operator<=>(const PackageInfo&, const PackageInfo&);

   struct ServiceInfo
   {
      std::vector<std::string>     flags;
      std::optional<AccountNumber> server;
      std::optional<ServiceSchema> schema;

      std::uint64_t parseFlags() const;
   };
   PSIO_REFLECT(ServiceInfo, flags, server, schema)

   struct PackagedService
   {
      explicit PackagedService(std::vector<char> buf);
      std::span<const AccountNumber> accounts() const;

      // returns {target path, mime-type}
      static std::pair<std::string_view, std::string_view> dataFileInfo(std::string_view path);

      void genesis(std::vector<GenesisService>& out);
      bool hasService(AccountNumber service) const;
      void installCode(std::vector<Action>& actions);
      void setSchema(std::vector<Action>& actions);
      void storeData(std::vector<Action>& actions);
      void regServer(std::vector<Action>& actions);
      void postinstall(std::vector<Action>& actions, std::span<const PackagedService> packages);
      void commitInstall(std::vector<Action>& actions, AccountNumber sender);

      std::vector<char>                                                    buf;
      zip::ZipReader                                                       archive;
      PackageMeta                                                          meta;
      std::vector<std::tuple<AccountNumber, zip::FileHeader, ServiceInfo>> services;
      std::vector<std::pair<AccountNumber, zip::FileHeader>>               data;
      std::optional<zip::FileHeader>                                       postinstallScript;
   };

   class DirectoryRegistry
   {
     public:
      DirectoryRegistry(std::string_view path);
      PackagedService get(std::string_view name) const;
      PackagedService get(const PackageInfo& info) const;
      // Packages will be returned in the order that they should be
      // installed. Packages containing services in priorityServices
      // will be as close to the front as possible.
      std::vector<PackagedService> resolve(std::span<const std::string>   packages,
                                           std::span<const AccountNumber> priorityServices = {});

     private:
      std::string path;
   };

}  // namespace psibase
