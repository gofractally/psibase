#pragma once

#include <psibase/Table.hpp>
#include <psibase/contractEntry.hpp>

namespace psibase
{
   struct WebContentRow
   {
      std::string       path        = {};
      std::string       contentType = {};
      std::vector<char> content     = {};
   };
   PSIO_REFLECT(WebContentRow, path, contentType, content)
   using WebContentTable = Table<WebContentRow, &WebContentRow::path>;

   template <typename... Tables>
   void storeContent(std::string&&                    path,
                     std::string&&                    contentType,
                     std::vector<char>&&              content,
                     const ContractTables<Tables...>& tables)
   {
      psibase::WebContentRow row{
          .path        = std::move(path),
          .contentType = std::move(contentType),
          .content     = std::move(content),
      };
      auto table = tables.template open<psibase::WebContentTable>();
      table.put(row);
   }

   template <typename... Tables>
   std::optional<RpcReplyData> serveContent(const RpcRequestData&            request,
                                            const ContractTables<Tables...>& tables)
   {
      if (request.method == "GET")
      {
         auto index = tables.template open<WebContentTable>().template getIndex<0>();
         if (auto content = index.get(request.target))
         {
            return RpcReplyData{
                .contentType = content->contentType,
                .body        = content->content,
            };
         }
      }
      return std::nullopt;
   }

}  // namespace psibase
