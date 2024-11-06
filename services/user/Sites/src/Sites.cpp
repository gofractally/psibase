#include "services/user/Sites.hpp"

#include <psibase/dispatch.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serveSchema.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <regex>
#include <services/system/Accounts.hpp>
#include <sstream>

using namespace psibase;

namespace SystemService
{
   namespace
   {
      std::string to_lower(const std::string& str)
      {
         std::string lower(str.size(), '\0');
         std::ranges::transform(str, lower.begin(), ::tolower);
         return lower;
      }

      template <typename T>
      bool contains(const std::vector<T>& vec, const T& value)
      {
         return std::find(vec.begin(), vec.end(), value) != vec.end();
      }

      std::vector<std::string> split(const std::string& str, char delimiter)
      {
         std::vector<std::string> tokens;
         for (auto&& part : str | std::views::split(delimiter))
         {
            tokens.emplace_back(to_lower(std::string(part.begin(), part.end())));
         }
         return tokens;
      }

      bool isSubdomain(const psibase::HttpRequest& req)
      {
         return req.host.size() > req.rootHost.size() + 1  //
                && req.host.ends_with(req.rootHost)        //
                && req.host[req.host.size() - req.rootHost.size() - 1] == '.';
      }

      AccountNumber getTargetService(const HttpRequest& req)
      {
         std::string serviceName;

         // Path reserved across all subdomains
         if (req.target.starts_with("/common"))
            serviceName = "common-api";

         // subdomain
         else if (isSubdomain(req))
            serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

         // root domain
         else
            serviceName = "homepage";

         return AccountNumber(serviceName);
      }

      // Checks for an extension to determine if it is a static asset
      bool isStaticAsset(const std::string& target)
      {
         auto last_slash_pos = target.find_last_of('/');
         return target.find('.', last_slash_pos) != target.npos;
      }

      // Remove query parameters from the target
      std::string normalizeTarget(const std::string& t)
      {
         std::string target = t;
         auto        pos    = target.find('?');
         if (pos != target.npos)
            target.resize(pos);
         return target;
      }

      /*
        script-src:
          * `unsafe-eval` is needed for WebAssembly.compile()
          * `unsafe-inline` is needed for inline <script> tags
          * `blob:` for loading dynamically generated modules
          * `https:` for dynamically loading libs from CDNs
        font-src:
          * `https:` for dynamically loading fonts from CDNs
        frame-src:
          * `*` is needed to allow embedding supervisor
        connect-src:
          * `blob:` for fetch-compiling blob urls
          * `*` allows fetching plugins, as well as websocket connections
      */
      const std::string DEFAULT_CSP_HEADER =                               //
          "default-src 'self';"                                            //
          "font-src 'self' https:;"                                        //
          "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https:;"  //
          "img-src *;"                                                     //
          "style-src 'self' 'unsafe-inline';"                              //
          "frame-src *;"                                                   //
          "connect-src * blob:;"                                           //
          ;

      // Accepted content encodings
      const std::array<std::string, 2> validEncodings = {"br", "gzip"};  // KEEP SORTED

      // Content-coding-identifier, e.g. "br", "gzip", etc.
      using cci = std::string;
      // The account that holds the service code implementing the DecompressorInterface
      using decompressor_account                                              = std::string;
      const std::array<std::pair<cci, decompressor_account>, 1> decompressors = {
          {{"br", "psi-brotli"}}  //
      };

      std::vector<std::string> clarify_accepted_encodings(
          const std::vector<std::string>& accepted_encodings)
      {
         // Any encodings specified with ;q=0 are being explicitly rejected by the client. Remove them.
         // Any other quality values should be ignored, as we do not support server side compression.
         // If identity is not explicitly rejected, ensure it's assumed to be supported.
         //
         // Justification on ignoring qvalues from RFC 7231:
         //   "Note: Most HTTP/1.0 applications do not recognize or obey qvalues
         //   associated with content-codings.  This means that qvalues might
         //   not work..."
         std::vector<std::string> rejected;
         std::vector<std::string> encodings;
         for (const auto& encoding : accepted_encodings)
         {
            auto reject_index = encoding.find(";q=0");
            if (reject_index != encoding.npos)
            {
               rejected.push_back(encoding.substr(0, reject_index));
               continue;
            }

            auto quality_index = encoding.find(";q=");
            if (quality_index != encoding.npos)
            {
               encodings.push_back(encoding.substr(0, quality_index));
            }
            else
            {
               encodings.push_back(encoding);
            }
         }

         // If identity was not already added
         if (!contains<std::string>(encodings, "identity"))
         {
            // And it was not explicitly rejected
            if (!contains<std::string>(rejected, "identity") &&
                !contains<std::string>(rejected, "*"))
            {
               // Add it
               encodings.push_back("identity");
            }
         }

         return encodings;
      }

      std::optional<std::string> get_decompressor(const std::string& encoding)
      {
         auto it = std::find_if(decompressors.begin(), decompressors.end(),
                                [encoding](const auto& pair) { return pair.first == encoding; });
         if (it == decompressors.end())
            return std::nullopt;
         return it->second;
      }

      std::optional<std::string> get_header_value(const HttpRequest& request,
                                                  const std::string& name)
      {
         auto it = std::find_if(request.headers.begin(), request.headers.end(),
                                [name](const HttpHeader& header)
                                { return to_lower(header.name) == to_lower(name); });
         if (it == request.headers.end())
            return std::nullopt;
         return it->value;
      }

      HttpReply make406(std::string_view message)
      {
         return HttpReply{
             .status      = HttpStatus::notAcceptable,
             .contentType = "text/plain",
             .body        = std::vector<char>(message.begin(), message.end()),
         };
      }

      bool shouldCache(const HttpRequest& request, const std::string& etag)
      {
         auto ifNoneMatch = get_header_value(request, "If-None-Match");
         return ifNoneMatch && *ifNoneMatch == etag;
      }

   }  // namespace

   std::optional<HttpReply> Sites::serveSys(HttpRequest request)
   {
      if (request.host.size() < request.rootHost.size())
      {
         check(false, "request host invalid: \"" + request.host + "\"");
      }

      auto account = getTargetService(request);
      if (account == Sites::service)
      {
         return serveSitesApp(request);
      }

      if (request.method == "GET" || request.method == "HEAD")
      {
         Tables tables{};
         auto   target = normalizeTarget(request.target);

         std::optional<SitesContentRow> content;
         auto                           isSpa = useSpa(account);
         if (isSpa)
         {
            if (!isStaticAsset(target))
            {
               target = "/index.html";
            }

            auto index = tables.open<SitesContentTable>().getIndex<0>();
            content    = index.get(SitesContentKey{account, target});
         }
         else
         {
            auto index = tables.open<SitesContentTable>().getIndex<0>();
            content    = index.get(SitesContentKey{account, target});
            if (!content)
            {
               if (target.ends_with('/'))
                  content = index.get(SitesContentKey{account, target + "index.html"});
               else
                  content = index.get(SitesContentKey{account, target + "/index.html"});
            }

            if (!content)
            {
               content = useDefaultProfile(target);
            }
         }

         if (content)
         {
            std::string cspHeader = getCspHeader(content, account);
            auto        etag      = std::to_string(content->hash);

            if (useCache(account) && shouldCache(request, etag))
            {
               // https://issues.chromium.org/issues/40132719
               // Chrome bug - Devtools still shows 200 status code sometimes
               return HttpReply{
                   .status  = HttpStatus::notModified,
                   .headers = {{"ETag", etag}},
               };
            }

            std::vector<HttpHeader> headers = {{
                {"Content-Security-Policy", cspHeader},
                {"Cache-Control", "no-cache"},
                {"ETag", etag},
            }};

            // RFC 7231
            // "A request without an Accept-Encoding header field implies that the
            // user agent has no preferences regarding content-codings.
            //
            // ...If a non-empty Accept-Encoding header field is present in a request and
            // none of the available representations for the response have a content
            // coding that is listed as acceptable, the origin server SHOULD send a
            // response without any content coding unless the identity coding is
            // indicated as unacceptable.""
            auto acceptEncoding = get_header_value(request, "Accept-Encoding");
            if (acceptEncoding)
            {
               auto trimmed           = std::regex_replace(*acceptEncoding, std::regex("\\s+"), "");
               auto acceptedEncodings = split(trimmed, ',');
               acceptedEncodings      = clarify_accepted_encodings(acceptedEncodings);

               auto is_accepted = [&acceptedEncodings](const std::string& e) {  //
                  return contains<std::string>(acceptedEncodings, e);
               };

               if (!content->contentEncoding)
               {
                  if (is_accepted("identity"))
                  {
                     headers.push_back({"Content-Encoding", "identity"});
                  }
                  else
                  {
                     return make406(
                         "Requested encoding not supported. Requested content uses "
                         "identity encoding.");
                  }
               }
               else  // Requested content has an encoding
               {
                  const auto encoding = *content->contentEncoding;
                  if (is_accepted(encoding))
                  {
                     headers.push_back({"Content-Encoding", encoding});
                  }
                  else
                  {
                     auto decompressor = get_decompressor(encoding);
                     // If identity is accepted and we can decompress the content, do that
                     // Otherwise, 406
                     if (!is_accepted("identity") || !decompressor)
                     {
                        return make406("Requested encoding not supported.");
                     }

                     // Decompress the content (don't bother if it's a HEAD request)
                     if (request.method != "HEAD")
                     {
                        auto decompressorAccount = AccountNumber{*decompressor};

                        check(to<Accounts>().exists(decompressorAccount),
                              "[Fallback decompression error] Decompressor account not found");

                        Actor<DecompressorInterface> decoder(Sites::service, decompressorAccount);
                        content->content = decoder.decompress(content->content);
                     }
                     headers.push_back({"Content-Encoding", "identity"});
                  }
               }
            }
            else  // Request does not specify accepted encodings
            {
               if (content->contentEncoding)
               {
                  headers.push_back({"Content-Encoding", *content->contentEncoding});
               }
               else
               {
                  headers.push_back({"Content-Encoding", "identity"});
               }
            }

            auto reply = HttpReply{
                .contentType = content->contentType,
                .headers     = std::move(headers),
            };

            if (request.method != "HEAD")
            {
               reply.body = content->content;
            }

            return reply;
         }
      }

      return std::nullopt;
   }

   void Sites::storeSys(std::string                path,
                        std::string                contentType,
                        std::optional<std::string> contentEncoding,
                        std::vector<char>          content)
   {
      Tables tables{};
      auto   table = tables.template open<SitesContentTable>();

      check(path.starts_with('/'), "Path doesn't begin with /");
      auto hash = psio::detail::seahash(std::string_view(content.data(), content.size()));

      if (contentEncoding)
      {
         check(std::ranges::binary_search(validEncodings, *contentEncoding),
               "Unsupported content encoding");
      }

      SitesContentRow row{
          .account         = getSender(),
          .path            = std::move(path),
          .contentType     = std::move(contentType),
          .content         = std::move(content),
          .hash            = hash,
          .contentEncoding = std::move(contentEncoding),
      };
      table.put(row);
   }

   void Sites::removeSys(std::string path)
   {
      Tables tables{};
      auto   table = tables.open<SitesContentTable>();
      table.erase(SitesContentKey{getSender(), path});
   }

   bool Sites::isValidPath(AccountNumber site, std::string path)
   {
      auto target = normalizeTarget(path);
      auto isSpa  = useSpa(site);

      // For a single-page application, all we can do is verify static assets and the root document
      if (isSpa)
      {
         if (!isStaticAsset(target))
         {
            target = "/index.html";
         }

         auto content = Tables{}.open<SitesContentTable>().get(SitesContentKey{site, target});
         return !!content;
      }
      else
      {
         // For traditional multi-page apps, we verify the path, and if it's not a static asset then we also
         // automatically check for `target/index.html`
         auto index   = Tables{}.open<SitesContentTable>().getIndex<0>();
         auto content = index.get(SitesContentKey{site, target});
         if (!content)
         {
            if (target.ends_with('/'))
               content = index.get(SitesContentKey{site, target + "index.html"});
            else if (!isStaticAsset(target))
               content = index.get(SitesContentKey{site, target + "/index.html"});
         }
         return !!content;
      }
   }

   void Sites::enableSpa(bool enable)
   {
      auto table = Tables{}.open<SiteConfigTable>();
      auto row   = table.get(getSender())
                     .value_or(SiteConfigRow{
                         .account = getSender(),
                         .spa     = enable,
                     });
      row.spa = enable;
      table.put(row);
   }

   void Sites::setCsp(std::string path, std::string csp)
   {
      Tables tables{};
      if (path == "*")
      {
         auto table = tables.open<GlobalCspTable>();
         table.put({
             .account = getSender(),
             .csp     = std::move(csp),
         });
      }
      else
      {
         auto table   = tables.open<SitesContentTable>();
         auto index   = table.getIndex<0>();
         auto content = index.get(SitesContentKey{getSender(), path});
         check(!!content, "Content not found for the specified path");

         content->csp = std::move(csp);
         table.put(*content);
      }
   }

   void Sites::enableCache(bool enable)
   {
      auto table = Tables{}.open<SiteConfigTable>();
      auto row   = table.get(getSender()).value_or(SiteConfigRow{.account = getSender()});
      row.cache  = enable;
      table.put(row);
   }

   std::optional<SitesContentRow> Sites::useDefaultProfile(const std::string& target)
   {
      auto index = Tables{}.open<SitesContentTable>().getIndex<0>();

      std::optional<SitesContentRow> content;
      if (target == "/" || target.starts_with("/default-profile/"))
      {
         content =
             index.get(SitesContentKey{getReceiver(), "/default-profile/default-profile.html"});
      }
      return content;
   }

   bool Sites::useSpa(const psibase::AccountNumber& account)
   {
      auto siteConfig = Tables{}.open<SiteConfigTable>().get(account);
      return siteConfig && siteConfig->spa;
   }

   std::string Sites::getCspHeader(const std::optional<SitesContentRow>& content,
                                   const AccountNumber&                  account)
   {
      std::string cspHeader = DEFAULT_CSP_HEADER;
      if (content && !content->csp.empty())
      {
         cspHeader = content->csp;
      }
      else
      {
         auto globalCsp = Tables{}.open<GlobalCspTable>().get(account);
         if (globalCsp)
         {
            cspHeader = globalCsp->csp;
         }
      }
      return cspHeader;
   }

   bool Sites::useCache(const AccountNumber& account)
   {
      auto siteConfig = Tables{}.open<SiteConfigTable>().get(account).value_or(
          SiteConfigRow{.account = getSender()});
      return siteConfig.cache;
   }

   namespace
   {
      struct Query
      {
         AccountNumber service;

         auto content() const
         {
            return Sites::Tables{service}.open<SitesContentTable>().getIndex<0>();
         }
      };
      PSIO_REFLECT(Query, method(content))
   }  // namespace

   std::optional<HttpReply> Sites::serveSitesApp(const HttpRequest& request)
   {
      if (auto result = psibase::serveActionTemplates<Sites>(request))
         return result;

      if (auto result = psibase::servePackAction<Sites>(request))
         return result;

      if (auto result = psibase::serveSchema<Sites>(request))
         return result;

      if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
         return result;

      if (auto result = psibase::serveSimpleUI<Sites, true>(request))
         return result;

      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Sites)
