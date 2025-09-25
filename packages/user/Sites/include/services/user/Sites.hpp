#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace SystemService
{
   using SitesContentKey = std::tuple<psibase::AccountNumber, std::string>;
   struct SitesContentRow
   {
      psibase::AccountNumber     account;
      std::string                path;
      std::string                contentType;
      psibase::Checksum256       contentHash;
      std::optional<std::string> contentEncoding;
      std::optional<std::string> csp;

      using Key = psibase::CompositeKey<&SitesContentRow::account, &SitesContentRow::path>;
   };
   PSIO_REFLECT(SitesContentRow, account, path, contentType, contentHash, contentEncoding, csp)
   using SitesContentTable = psibase::Table<SitesContentRow, SitesContentRow::Key{}>;
   PSIO_REFLECT_TYPENAME(SitesContentTable)

   struct SitesDataRow
   {
      psibase::Checksum256 hash;
      std::vector<char>    data;
   };
   PSIO_REFLECT(SitesDataRow, hash, data)

   using SitesDataTable = psibase::Table<SitesDataRow, &SitesDataRow::hash>;
   PSIO_REFLECT_TYPENAME(SitesDataTable)

   struct SitesDataRefRow
   {
      psibase::Checksum256 hash;
      std::uint32_t        refs;
   };
   PSIO_REFLECT(SitesDataRefRow, hash, refs)

   using SitesDataRefTable = psibase::Table<SitesDataRefRow, &SitesDataRefRow::hash>;
   PSIO_REFLECT_TYPENAME(SitesDataRefTable)

   struct SiteConfigRow
   {
      psibase::AccountNumber     account;
      bool                       spa;
      bool                       doNotCache;
      std::optional<std::string> globalCsp;
   };
   PSIO_REFLECT(SiteConfigRow, account, spa, doNotCache, globalCsp)
   using SiteConfigTable = psibase::Table<SiteConfigRow, &SiteConfigRow::account>;
   PSIO_REFLECT_TYPENAME(SiteConfigTable)

   /// Decompress content
   ///
   /// `DecompressorInterface` is implemented by services that can decompress content
   /// with a specific encoding.
   ///
   /// Decompressor services should not inherit from this struct,
   /// instead they should define actions with matching signatures.
   ///
   /// The `sites` service uses decompressor services who implement this interface to
   /// decompress content when the client's accepted encodings do not include the
   /// content's encoding.
   struct DecompressorInterface
   {
      /// Decompresses content compressed with some algorithm
      std::vector<char> decompress(const std::vector<char>& content);
   };
   PSIO_REFLECT(DecompressorInterface, method(decompress, content))

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
      using Tables                  = psibase::
          ServiceTables<SitesContentTable, SiteConfigTable, SitesDataTable, SitesDataRefTable>;

      /// Serves a request by looking up the content uploaded to the specified subdomain
      auto serveSys(psibase::HttpRequest request) -> std::optional<psibase::HttpReply>;

      /// Stores content accessible at the caller's subdomain
      void storeSys(std::string                path,
                    std::string                contentType,
                    std::optional<std::string> contentEncoding,
                    std::vector<char>          content);

      /// Adds a hard-link to a file. The file must already exist.
      void hardlink(std::string                path,
                    std::string                contentType,
                    std::optional<std::string> contentEncoding,
                    psibase::Checksum256       contentHash);

      /// Removes content from the caller's subdomain
      void remove(std::string path);

      /// Checks whether a request for content on a site at the given path is valid (such a request will not produce a 404).
      ///
      /// Note: For single-page applications, static assets (e.g. 'style.css') can be checked normally. However, all other assets
      /// are routed client-side, so a route like `/page1` is considered a valid route as long as the SPA serves a root document.
      bool isValidPath(psibase::AccountNumber site, std::string path);

      /// Enables/disables single-page application mode.
      /// When enabled, all content requests return the root document.
      void enableSpa(bool enable);

      /// Sets the Content Security Policy for the specified path (or "*" for a global CSP).
      /// If a specific CSP is set, it takes precedence over the global CSP.
      /// If no specific or global CSP is set, a default CSP is used.
      void setCsp(std::string path, std::string csp);

      /// Deletes the Content Security Policy for the specified path (or "*" for the global CSP).
      void deleteCsp(std::string path);

      /// Enables/disables HTTP caching of responses (Enabled by default)
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
                method(storeSys, path, contentType, contentEncoding, content),
                method(hardlink, path, contentType, contentEncoding, contentHash),
                method(remove, path),
                method(isValidPath, site, path),
                method(enableSpa, enable),
                method(setCsp, path, csp),
                method(deleteCsp, path),
                method(enableCache, enable))

   PSIBASE_REFLECT_TABLES(Sites, Sites::Tables)
}  // namespace SystemService
