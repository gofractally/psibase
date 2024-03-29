#pragma once

#include <psibase/Table.hpp>
#include <psibase/serviceEntry.hpp>

namespace psibase
{
   /// Content for serving over HTTP
   ///
   /// This the table row format for services which store and serve HTTP files
   /// using [storeContent] and [serveContent].
   ///
   /// Also includes this definition:
   ///
   /// ```c++
   /// using WebContentTable = Table<WebContentRow, &WebContentRow::path>;
   /// ```
   struct WebContentRow
   {
      std::string       path        = {};  ///< Absolute path to content, e.g. "/index.mjs"
      std::string       contentType = {};  ///< "text/html", "text/javascript", ...
      std::vector<char> content     = {};  ///< Content body
   };
   PSIO_REFLECT(WebContentRow, path, contentType, content)
   using WebContentTable = Table<WebContentRow, &WebContentRow::path>;

   /// Store web content in table
   ///
   /// This stores web content into a service's `WebContentTable`.
   /// [serveContent] serves this content via HTTP.
   ///
   /// Example use:
   ///
   /// ```c++
   /// // Don't forget to include your service's other tables in this!
   /// using Tables = psibase::ServiceTables<psibase::WebContentTable>;
   ///
   /// void MyService::storeSys(
   ///    std::string path, std::string contentType, std::vector<char> content)
   /// {
   ///    psibase::check(getSender() == getReceiver(), "wrong sender");
   ///    psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
   ///                          Tables{getReceiver()});
   /// }
   /// ```
   template <typename... Tables>
   void storeContent(std::string&&                   path,
                     std::string&&                   contentType,
                     std::vector<char>&&             content,
                     const ServiceTables<Tables...>& tables)
   {
      check(path.starts_with('/'), "Path doesn't begin with /");
      psibase::WebContentRow row{
          .path        = std::move(path),
          .contentType = std::move(contentType),
          .content     = std::move(content),
      };
      auto table = tables.template open<psibase::WebContentTable>();
      table.put(row);
   }

   /// Serve files via HTTP
   ///
   /// This serves files stored by [storeContent].
   ///
   /// Example use:
   /// ```c++
   /// // Don't forget to include your service's other tables in this!
   /// using Tables = psibase::ServiceTables<psibase::WebContentTable>;
   ///
   /// std::optional<psibase::HttpReply> MyService::serveSys(
   ///    psibase::HttpRequest request)
   /// {
   ///    if (auto result = psibase::serveContent(request, Tables{getReceiver()}))
   ///       return result;
   ///    return std::nullopt;
   /// }
   /// ```
   template <typename... Tables>
   std::optional<HttpReply> serveContent(const HttpRequest&              request,
                                         const ServiceTables<Tables...>& tables)
   {
      if (request.method == "GET")
      {
         auto index  = tables.template open<WebContentTable>().template getIndex<0>();
         auto target = request.target;
         auto pos    = target.find('?');
         if (pos != target.npos)
            target.resize(pos);
         auto content = index.get(target);
         if (!content)
         {
            if (target.ends_with('/'))
               content = index.get(target + "index.html");
            else
               content = index.get(target + "/index.html");
         }
         if (content)
         {
            return HttpReply{
                .contentType = content->contentType,
                .body        = content->content,
            };
         }
      }
      return std::nullopt;
   }

}  // namespace psibase
