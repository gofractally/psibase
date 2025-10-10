#include "services/user/Sites.hpp"

#include <boost/algorithm/string.hpp>
#include <psibase/api.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/serveActionTemplates.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <regex>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <set>

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
         if (req.target.starts_with(HttpServer::commonApiPrefix))
            serviceName = HttpServer::commonApiService.str();

         // subdomain
         else if (isSubdomain(req))
            serviceName.assign(req.host.begin(), req.host.end() - req.rootHost.size() - 1);

         // root domain
         else
            serviceName = HttpServer::homepageService.str();

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
          "img-src * data:;"                                               //
          "style-src 'self' 'unsafe-inline';"                              //
          "frame-src *;"                                                   //
          "connect-src * blob:;"                                           //
          ;

      // Accepted content encodings
      constexpr std::string_view validEncodings[] = {
          // KEEP SORTED
          "br",
          "gzip",
      };
      static_assert(std::ranges::is_sorted(validEncodings));

      // Content-coding-identifier, e.g. "br", "gzip", etc.
      using cci = std::string;
      // The account that holds the service code implementing the DecompressorInterface
      using decompressor_account                                              = std::string;
      const std::array<std::pair<cci, decompressor_account>, 1> decompressors = {
          {{"br", "brotli-codec"}}  //
      };

      // Parses the encoding into a pair of encoding identifier and quality
      // Example: "  br  ;   q=0.901   "
      // Returns: Some(pair("br", 901))
      std::pair<std::string, uint16_t> parseEncoding(const std::string& encoding)
      {
         // Overview:
         //    Split by semicolon
         //    Trim each part of trailing/leading whitespace
         //    Parse the quality value as a float between 0 and 1
         //    Convert the quality value into a uint between 0 and 1000 for comparison

         auto parts = split(encoding, ';');
         if (parts.empty())
         {
            check(false, "Invalid encoding: " + encoding);
         }

         std::string identifier = parts[0];
         boost::algorithm::trim(identifier);
         float quality = 1.0f;
         if (parts.size() > 1)
         {
            auto q = parts[1];
            boost::algorithm::trim(q);
            if (!q.starts_with("q="))
            {
               check(false, "Invalid encoding q value for: " + identifier);
            }

            q.erase(0, 2);

            // Use regex to match the q value specified in rfc 7231:
            // qvalue = ( "0" [ "." 0*3DIGIT ] )
            //        / ( "1" [ "." 0*3("0") ] )
            std::regex qualityRegex(R"(^(0(\.[0-9]{0,3})?|1(\.0{0,3})?)$)");
            if (!std::regex_match(q, qualityRegex))
            {
               check(false, "Invalid value for q: " + q);
            }

            char* end;
            float parsedQuality = std::strtof(q.c_str(), &end);
            if (*end != '\0')
            {
               check(false, "Invalid value for q: " + q);
            }

            quality = parsedQuality;
         }

         // Convert quality into a uint between 0 and 1000
         return std::make_pair(identifier, static_cast<uint16_t>(quality * 1000));
      }

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
            auto [identifier, quality] = parseEncoding(encoding);

            if (quality == 0)
            {
               rejected.push_back(identifier);
               continue;
            }

            encodings.push_back(identifier);
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
             .headers     = allowCors(),
         };
      }

      bool shouldCache(const HttpRequest& request, const std::string& etag)
      {
         auto ifNoneMatch = get_header_value(request, "If-None-Match");
         return ifNoneMatch && *ifNoneMatch == etag;
      }

      void decRef(Sites::Tables& tables, SitesDataRefTable& refsTable, const Checksum256& hash)
      {
         auto prevRefs = refsTable.get(hash);
         check(prevRefs.has_value(), "Invariant failure: missing ref count");
         if (--prevRefs->refs == 0)
         {
            tables.open<SitesDataTable>().erase(hash);
            refsTable.remove(*prevRefs);
         }
         else
         {
            refsTable.put(*prevRefs);
         }
      }

      // returns true if the link target exists
      bool linkImpl(Sites::Tables&             tables,
                    std::string                path,
                    std::string                contentType,
                    std::optional<std::string> contentEncoding,
                    psibase::Checksum256       contentHash)
      {
         auto table = tables.template open<SitesContentTable>();

         check(path.starts_with('/'), "Path doesn't begin with /");

         if (contentEncoding)
         {
            check(std::ranges::binary_search(validEncodings, *contentEncoding),
                  "Unsupported content encoding");
         }

         bool exists;

         // Update reference counts
         std::optional<SitesContentRow> prev =
             table.getIndex<0>().get(std::tuple(getSender(), path));
         if (prev)
         {
            if (prev->contentHash != contentHash)
            {
               auto refsTable = tables.open<SitesDataRefTable>();
               decRef(tables, refsTable, prev->contentHash);
               auto refs = refsTable.get(contentHash)
                               .value_or(SitesDataRefRow{.hash = contentHash, .refs = 0});
               exists = refs.refs > 0;
               ++refs.refs;
               refsTable.put(refs);
            }
            else
            {
               exists = true;
            }
         }
         else
         {
            auto            refsTable = tables.open<SitesDataRefTable>();
            SitesDataRefRow refs      = refsTable.get(contentHash)
                                       .value_or(SitesDataRefRow{.hash = contentHash, .refs = 0});
            exists = refs.refs > 0;
            ++refs.refs;
            refsTable.put(refs);
         }

         SitesContentRow row{
             .account         = getSender(),
             .path            = std::move(path),
             .contentType     = std::move(contentType),
             .contentHash     = contentHash,
             .contentEncoding = std::move(contentEncoding),
             .csp             = std::nullopt,
         };
         table.put(row);

         return exists;
      }

      std::optional<psibase::AccountNumber> getProxy(const psibase::AccountNumber& account)
      {
         auto table      = Sites::Tables{getReceiver(), KvMode::read}.open<SiteConfigTable>();
         auto siteConfig = table.get(account);

         if (!siteConfig || !siteConfig->proxyAccount)
         {
            return std::nullopt;
         }

         return *siteConfig->proxyAccount;
      }

      bool useSpa(const psibase::AccountNumber& account)
      {
         auto siteConfig =
             Sites::Tables{getReceiver(), KvMode::read}.open<SiteConfigTable>().get(account);
         return siteConfig && siteConfig->spa;
      }

      std::optional<SitesContentRow> getContent(const psibase::AccountNumber& account,
                                                const std::string&            target)
      {
         auto tables = Sites::Tables{getReceiver(), KvMode::read};
         auto isSpa  = useSpa(account);

         std::optional<SitesContentRow> content;

         auto index = tables.open<SitesContentTable>().getIndex<0>();

         if (isSpa)
         {
            auto t  = isStaticAsset(target) ? target : "/index.html";
            content = index.get(SitesContentKey{account, t});
         }
         else
         {
            content = index.get(SitesContentKey{account, target});
            if (!content)
            {
               auto t  = target.ends_with('/') ? target : target + '/';
               content = index.get(SitesContentKey{account, t + "index.html"});
            }
         }

         if (!content)
         {
            auto proxyTarget = getProxy(account);
            if (proxyTarget)
            {
               content = getContent(*proxyTarget, target);
            }
         }

         return content;
      }

   }  // namespace

   std::optional<HttpReply> Sites::serveSys(HttpRequest request)
   {
      if (request.host.size() < request.rootHost.size())
      {
         check(false, "request host invalid: \"" + request.host + "\"");
      }

      auto account = getTargetService(request);

      if (request.method == "GET" || request.method == "HEAD")
      {
         Tables tables{getReceiver(), KvMode::read};
         auto   target = request.path();

         auto content = getContent(account, target);

         if (content)
         {
            std::string cspHeader = getCspHeader(content, content->account);
            auto etag = psio::hex(content->contentHash.data(), content->contentHash.data() + 8);

            if (useCache(content->account) && shouldCache(request, etag))
            {
               // https://issues.chromium.org/issues/40132719
               // Chrome bug - Devtools still shows 200 status code sometimes
               return HttpReply{
                   .status  = HttpStatus::notModified,
                   .headers = {{"ETag", etag},
                               {"Access-Control-Allow-Origin", "*"},
                               {"Access-Control-Allow-Methods", "GET, OPTIONS, HEAD"},
                               {"Access-Control-Allow-Headers", "*"}},
               };
            }

            auto reply = HttpReply{
                .contentType = content->contentType,
                .headers     = {{"Content-Security-Policy", cspHeader},
                                {"Cache-Control", "no-cache"},
                                {"ETag", etag},
                                {"Access-Control-Allow-Origin", "*"},
                                {"Access-Control-Allow-Methods", "GET, OPTIONS, HEAD"},
                                {"Access-Control-Allow-Headers", "*"}},
            };

            if (request.method != "HEAD")
            {
               auto index = tables.open<SitesDataTable>().getIndex<0>();
               auto body  = index.get(content->contentHash);
               check(body.has_value(), "Invariant failure: file content missing");
               reply.body = std::move(body->data);
            }

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
               auto acceptedEncodings = split(*acceptEncoding, ',');
               acceptedEncodings      = clarify_accepted_encodings(acceptedEncodings);

               auto is_accepted = [&acceptedEncodings](const std::string& e) {  //
                  return contains<std::string>(acceptedEncodings, e);
               };

               if (!content->contentEncoding)
               {
                  if (!is_accepted("identity"))
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
                     reply.headers.push_back({"Content-Encoding", encoding});
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
                        reply.body = decoder.decompress(std::move(reply.body));
                     }
                  }
               }
            }
            else  // Request does not specify accepted encodings
            {
               if (content->contentEncoding)
               {
                  reply.headers.push_back({"Content-Encoding", *content->contentEncoding});
               }
            }

            return reply;
         }
      }

      if (account == Sites::service)
      {
         return serveSitesApp(request);
      }

      return std::nullopt;
   }

   void Sites::storeSys(std::string                path,
                        std::string                contentType,
                        std::optional<std::string> contentEncoding,
                        std::vector<char>          content)
   {
      Tables tables{};

      Checksum256 contentHash = sha256(content.data(), content.size());

      if (!linkImpl(tables, std::move(path), std::move(contentType), std::move(contentEncoding),
                    contentHash))
      {
         tables.open<SitesDataTable>().put({
             .hash = contentHash,
             .data = std::move(content),
         });
      }
   }

   void Sites::hardlink(std::string                path,
                        std::string                contentType,
                        std::optional<std::string> contentEncoding,
                        psibase::Checksum256       contentHash)
   {
      Tables tables{};

      if (!linkImpl(tables, std::move(path), std::move(contentType), std::move(contentEncoding),
                    contentHash))
      {
         abortMessage("Content must exist to use hardlink");
      }
   }

   void Sites::remove(std::string path)
   {
      Tables tables{};
      auto   table = tables.open<SitesContentTable>();
      if (auto existing = table.get(SitesContentKey{getSender(), path}))
      {
         table.remove(*existing);

         auto refsTable = tables.open<SitesDataRefTable>();
         decRef(tables, refsTable, existing->contentHash);
      }
   }

   bool Sites::isValidPath(AccountNumber site, std::string path)
   {
      auto target  = normalizeTarget(path);
      auto content = getContent(site, target);
      return !!content;
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
         auto siteTable = tables.open<SiteConfigTable>();
         auto site = siteTable.get(getSender()).value_or(SiteConfigRow{.account = getSender()});
         site.globalCsp = std::optional{std::move(csp)};
         siteTable.put(std::move(site));
      }
      else
      {
         auto contentTable = tables.open<SitesContentTable>();
         auto content      = contentTable.get(SitesContentKey{getSender(), path});
         check(!!content, "Invalid path");

         content->csp = std::optional{std::move(csp)};
         contentTable.put(*content);
      }
   }

   void Sites::deleteCsp(std::string path)
   {
      Tables tables{};

      if (path == "*")
      {
         auto siteTable = tables.open<SiteConfigTable>();
         auto site      = siteTable.get(getSender());
         check(!!site, "Site not found");
         site->globalCsp = std::nullopt;
         siteTable.put(*site);
      }
      else
      {
         auto contentTable = tables.open<SitesContentTable>();
         auto content      = contentTable.get(SitesContentKey{getSender(), path});
         check(!!content, "Invalid path");

         content->csp = std::nullopt;
         contentTable.put(*content);
      }
   }

   void Sites::enableCache(bool enable)
   {
      auto table = Tables{}.open<SiteConfigTable>();
      auto row   = table.get(getSender()).value_or(SiteConfigRow{.account = getSender()});
      row.cache  = enable;
      table.put(row);
   }

   void Sites::setProxy(psibase::AccountNumber proxy)
   {
      auto self = getSender();

      std::set<psibase::AccountNumber> visited{self};
      psibase::AccountNumber           current = proxy;

      auto table = open<SiteConfigTable>();
      while (true)
      {
         check(!visited.contains(current), "Proxy chain would create a cycle");

         visited.insert(current);

         auto siteConfig = table.get(current);
         if (!siteConfig || !siteConfig->proxyAccount)
         {
            break;
         }

         current = *siteConfig->proxyAccount;
      }

      auto row         = table.get(self).value_or(SiteConfigRow{.account = self});
      row.proxyAccount = std::optional{std::move(proxy)};
      table.put(row);
   }

   void Sites::clearProxy()
   {
      auto table = Tables{}.open<SiteConfigTable>();
      auto row   = table.get(getSender());
      if (!row || !row->proxyAccount)
      {
         return;
      }
      row->proxyAccount = std::nullopt;
      table.put(*row);
   }

   std::string Sites::getCspHeader(const std::optional<SitesContentRow>& content,
                                   const AccountNumber&                  account)
   {
      std::string cspHeader = DEFAULT_CSP_HEADER;
      if (content && content->csp.has_value())
      {
         cspHeader = *content->csp;
      }
      else
      {
         auto siteConfig = open<SiteConfigTable>(KvMode::read).get(account);
         if (siteConfig && siteConfig->globalCsp)
         {
            cspHeader = *siteConfig->globalCsp;
         }
      }
      return cspHeader;
   }

   bool Sites::useCache(const AccountNumber& account)
   {
      auto siteConfig = open<SiteConfigTable>(KvMode::read)
                            .get(account)
                            .value_or(SiteConfigRow{.account = getSender()});
      return siteConfig.cache;
   }

   namespace
   {
      struct SiteConfig
      {
         psibase::AccountNumber account;
         bool                   spa       = false;
         bool                   cache     = true;
         std::string            globalCsp = "";
         std::string            proxy     = "";
      };
      PSIO_REFLECT(SiteConfig, account, spa, cache, globalCsp)

      struct Query
      {
         AccountNumber service;

         auto getDefaultCsp() const -> std::string { return DEFAULT_CSP_HEADER; }

         auto getConfig(AccountNumber account) const -> std::optional<SiteConfig>
         {
            auto tables = Sites::Tables{service, KvMode::read};

            // Get the site config, or return a default
            auto record = tables.open<SiteConfigTable>().get(account).value_or(
                SiteConfigRow{.account = account});
            return SiteConfig{.account   = record.account,
                              .spa       = record.spa,
                              .cache     = record.cache,
                              .globalCsp = record.globalCsp.value_or(""),
                              .proxy     = record.proxyAccount ? record.proxyAccount->str() : ""};
         }

         auto getContent(AccountNumber account) const
         {
            auto tables = Sites::Tables{service, KvMode::read};

            auto idx =
                tables.open<SitesContentTable>().getIndex<0>().subindex<std::string>(account);

            return TransformedConnection(std::move(idx),
                                         [](auto&& row)
                                         {
                                            row.csp = row.csp.value_or("");
                                            return row;
                                         });
         }
      };
      PSIO_REFLECT(Query,                        //
                   method(getConfig, account),   //
                   method(getContent, account),  //
                   method(getDefaultCsp)         //
      );
   }  // namespace

   std::optional<HttpReply> Sites::serveSitesApp(const HttpRequest& request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{getReceiver()}))
         return result;

      if (auto result = psibase::serveSimpleUI<Sites, false>(request))
         return result;

      return std::nullopt;
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Sites)
