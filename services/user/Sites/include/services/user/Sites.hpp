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

   struct SiteConfigRow
   {
      psibase::AccountNumber account;
      bool                   spa = false;
   };
   PSIO_REFLECT(SiteConfigRow, account, spa)
   using SiteConfigTable = psibase::Table<SiteConfigRow, &SiteConfigRow::account>;

   /// Provide web hosting
   ///
   /// This service provides web hosting to all accounts. It is the default server that handles
   /// hosting of the [`data`](../specifications/data-formats/package.md) items specified in psibase packages.
   ///
   /// See [psibase CLI docs](../run-infrastructure/cli/psibase.md) for details on how to upload files and directories.
   ///
   /// After files are uploaded, the site is available at `http://$ACCOUNT.$DOMAIN`
   class Sites : psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("sites");
      using Tables                  = psibase::ServiceTables<SitesContentTable, SiteConfigTable>;

      /// Serves a request by looking up the content uploaded to the specified subdomain
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

      /// Stores content accessible at the caller's subdomain
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

      /// Removes content from the caller's subdomain
      void removeSys(std::string path);

      /// Enables/disables single-page application mode.
      /// When enabled, all content requests return the root document.
      void enableSpa(bool enable);

     private:
      std::optional<SitesContentRow>    useDefaultProfile(const std::string& target);
      bool                              useSpa(const psibase::AccountNumber& account);
      std::optional<psibase::HttpReply> serveSitesApp(const psibase::HttpRequest& request);
   };

   PSIO_REFLECT(Sites,
                method(serveSys, request),
                method(storeSys, path, contentType, content),
                method(removeSys, path),
                method(enableSpa, enable))
}  // namespace SystemService
