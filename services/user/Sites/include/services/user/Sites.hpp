#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace SystemService
{
   struct SitesContentKey
   {
      psibase::AccountNumber account = {};
      std::string            path    = {};

      // TODO: upgrade wasi-sdk; <=> for string is missing
      friend bool operator<(const SitesContentKey& a, const SitesContentKey& b)
      {
         return std::tie(a.account, a.path) < std::tie(b.account, b.path);
      }
   };
   PSIO_REFLECT(SitesContentKey, account, path)

   struct SitesContentRow
   {
      psibase::AccountNumber account     = {};
      std::string            path        = {};
      std::string            contentType = {};
      std::vector<char>      content     = {};

      SitesContentKey key() const { return {account, path}; }
   };
   PSIO_REFLECT(SitesContentRow, account, path, contentType, content)
   using SitesContentTable = psibase::Table<SitesContentRow, &SitesContentRow::key>;

   /// Provide web hosting
   ///
   /// This service provides web hosting to non-service accounts. It supports both an
   /// upload UI (TODO) and command-line upload using `psibase upload`.
   ///
   /// Uploading a directory tree:
   ///
   /// ```
   /// psibase -a $ROOT_URL -s $PVT_KEY upload -r -S $ACCOUNT sites $DIR /
   /// ```
   ///
   /// Uploading a single file:
   ///
   /// ```
   /// psibase -a $ROOT_URL -s $PVT_KEY upload -S $ACCOUNT sites
   ///           $PATH_TO_FILE /index.html
   /// ```
   ///
   /// You don't need the `-a` and `-s` options if your running a local test chain at
   /// `http://psibase.127.0.0.1.sslip.io:8080/` and don't protect the accounts with keypairs.
   ///
   /// After files are uploaded, the site is available at `http://$ACCOUNT.$DOMAIN`
   struct Sites : psibase::Service<Sites>
   {
      static constexpr auto service = psibase::AccountNumber("sites");
      using Tables                  = psibase::ServiceTables<SitesContentTable>;

      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;
      void storeSys(std::string path, std::string contentType, std::vector<char> content);
      void removeSys(std::string path);
   };

   PSIO_REFLECT(Sites,
                method(serveSys, request),
                method(storeSys, path, contentType, content),
                method(removeSys, path))
}  // namespace SystemService
