#pragma once

#include <map>
#include <optional>
#include <psibase/AccountNumber.hpp>
#include <psibase/block.hpp>
#include <psibase/crypto.hpp>
#include <psibase/zip.hpp>
#include <psio/from_json.hpp>
#include <psio/reflect.hpp>
#include <span>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

namespace psibase
{

   struct Meta
   {
      std::string                name;
      std::string                description;
      std::vector<std::string>   depends;
      std::vector<AccountNumber> accounts;
   };
   PSIO_REFLECT(Meta, name, description, depends, accounts)

   struct PackageInfo
   {
      std::string                name;
      std::string                description;
      std::vector<std::string>   depends;
      std::vector<AccountNumber> accounts;
      Checksum256                sha256;
      std::string                file;
   };
   PSIO_REFLECT(PackageInfo, name, description, depends, accounts, sha256, file)

   struct ServiceInfo
   {
      std::vector<std::string>     flags;
      std::optional<AccountNumber> server;
   };
   PSIO_REFLECT(ServiceInfo, flags, server)

   struct PackagedService
   {
      explicit PackagedService(std::vector<char> buf);
      std::span<const AccountNumber> accounts() const;

      void genesis(std::vector<GenesisService>& out);
      bool hasService(AccountNumber service) const;
      void storeData(std::vector<Action>& actions);
      void regServer(std::vector<Action>& actions);
      void postinstall(std::vector<Action>& actions);
      void commitInstall(std::vector<Action>& actions);

      std::vector<char>                                                    buf;
      zip::ZipReader                                                       archive;
      Meta                                                                 meta;
      std::vector<std::tuple<AccountNumber, zip::FileHeader, ServiceInfo>> services;
      std::vector<std::pair<AccountNumber, zip::FileHeader>>               data;
      std::optional<zip::FileHeader>                                       postinstallScript;
   };

   class DirectoryRegistry
   {
     public:
      DirectoryRegistry(std::string_view path);
      PackagedService              get(std::string_view name) const;
      std::vector<PackagedService> resolve(std::span<const std::string> packages);

     private:
      std::string path;
   };

}  // namespace psibase
