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
      std::string            csp         = {};
      uint64_t               hash        = 0;

      SitesContentKey key() const { return {account, path}; }
   };
   PSIO_REFLECT(SitesContentRow, account, path, contentType, content, csp, hash)
   using SitesContentTable = psibase::Table<SitesContentRow, &SitesContentRow::key>;

   struct SiteConfigRow
   {
      psibase::AccountNumber account;
      bool                   spa   = false;
      bool                   cache = true;
   };
   PSIO_REFLECT(SiteConfigRow, account, spa, cache)
   using SiteConfigTable = psibase::Table<SiteConfigRow, &SiteConfigRow::account>;

   struct GlobalCspRow
   {
      psibase::AccountNumber account;
      std::string            csp;
   };
   PSIO_REFLECT(GlobalCspRow, account, csp)
   using GlobalCspTable = psibase::Table<GlobalCspRow, &GlobalCspRow::account>;

   /// Provide web hosting
   ///
   /// This service provides web hosting to all accounts. It is the default server that handles
   /// hosting of the [`data`](../specifications/data-formats/package.md) items specified in psibase packages.
   ///
   /// See [psibase CLI docs](../run-infrastructure/cli/psibase.md) for details on how to upload files and directories.
   ///
   /// After files are uploaded, the site is available at `http://$ACCOUNT.$DOMAIN`
   class Sites : psibase::Service<Sites>
   {
     public:
      static constexpr auto service = psibase::AccountNumber("sites");
      using Tables = psibase::ServiceTables<SitesContentTable, SiteConfigTable, GlobalCspTable>;

      /// Serves a request by looking up the content uploaded to the specified subdomain
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

      /// Stores content accessible at the caller's subdomain
      void storeSys(std::string path, std::string contentType, std::vector<char> content);

      /// Removes content from the caller's subdomain
      void removeSys(std::string path);

      /// Enables/disables single-page application mode.
      /// When enabled, all content requests return the root document.
      void enableSpa(bool enable);

      /// Sets the Content Security Policy for the specified path (or "*" for a global CSP).
      /// If a specific CSP is set, it takes precedence over the global CSP.
      /// If no specific or global CSP is set, a default CSP is used.
      void setCsp(std::string path, std::string csp);

      /// Enables/disables caching of responses (Enabled by default)
      /// Cache strategy:
      /// - `If-None-Match` header is checked against the hash of the content
      /// - The hash is stored in the `ETag` header
      /// - If the hash matches, a 304 Not Modified response is returned
      /// - If the hash does not match, the new content is returned with an updated `ETag` header
      void enableCache(bool enable);

     private:
      std::optional<SitesContentRow>    useDefaultProfile(const std::string& target);
      bool                              useSpa(const psibase::AccountNumber& account);
      bool                              useCache(const psibase::AccountNumber& account);
      std::optional<psibase::HttpReply> serveSitesApp(const psibase::HttpRequest& request);
      std::string                       getCspHeader(const std::optional<SitesContentRow>& content,
                                                     const psibase::AccountNumber&         account);
   };

   PSIO_REFLECT(Sites,
                method(serveSys, request),
                method(storeSys, path, contentType, content),
                method(removeSys, path),
                method(enableSpa, enable),
                method(setCsp, path, csp),
                method(enableCache, enable))
}  // namespace SystemService
