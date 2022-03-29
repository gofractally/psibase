#include "contracts/system/rpc_account_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/rpc_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

static constexpr bool enable_print = false;

using table_num = uint32_t;

static constexpr table_num web_content_table = 1;

inline auto web_content_key(psibase::account_num this_contract, std::string_view path)
{
   return std::tuple{this_contract, web_content_table, path};
}
struct web_content_row
{
   std::string       path         = {};
   std::string       content_type = {};
   std::vector<char> content      = {};

   auto key(psibase::account_num this_contract) { return web_content_key(this_contract, path); }
};
EOSIO_REFLECT(web_content_row, path, content_type, content)

struct augmented_account_row : psibase::account_row
{
   std::optional<std::string> name;
   std::optional<std::string> auth_contract_name;
};
EOSIO_REFLECT(augmented_account_row, base psibase::account_row, name, auth_contract_name)

namespace psibase
{
   rpc_reply_data rpc_account_sys::rpc_sys(rpc_request_data request)
   {
      auto to_json = [](const auto& obj) {
         auto json = eosio::convert_to_json(obj);
         return rpc_reply_data{
             .content_type = "application/json",
             .reply        = {json.begin(), json.end()},
         };
      };

      if (request.method == "GET")
      {
         auto content = kv_get<web_content_row>(web_content_key(get_receiver(), request.target));
         if (!!content)
         {
            return {
                .content_type = content->content_type,
                .reply        = content->content,
            };
         }

         if (request.target == "/accounts")
         {
            actor<account_sys>                 asys(get_receiver(), account_sys::contract);
            std::vector<augmented_account_row> rows;
            auto                               key      = eosio::convert_to_key(account_key(0));
            auto                               key_size = sizeof(account_table);
            while (true)
            {
               auto raw = kv_greater_equal_raw(account_row::kv_map, key, key_size);
               if (!raw)
                  break;
               auto acc = eosio::convert_from_bin<account_row>(*raw);
               key      = get_key();
               key.push_back(0);
               augmented_account_row aug;
               (account_row&)aug      = acc;
               aug.name               = asys.get_account_by_num(aug.num);
               aug.auth_contract_name = asys.get_account_by_num(aug.auth_contract);
               rows.push_back(std::move(aug));
            }
            return to_json(rows);
         }
      }

      abort_message("not found");
   }  // rpc_account_sys::rpc_sys

   void rpc_account_sys::upload_rpc_sys(psio::const_view<std::string>       path,
                                        psio::const_view<std::string>       content_type,
                                        psio::const_view<std::vector<char>> content)
   {
      check(get_sender() == get_receiver(), "wrong sender");

      // TODO
      auto              size = content.size();
      std::vector<char> c(size);
      for (size_t i = 0; i < size; ++i)
         c[i] = content[i];

      // TODO: avoid copies before pack
      web_content_row row{
          .path         = path,
          .content_type = content_type,
          .content      = std::move(c),
      };
      kv_put(row.key(get_receiver()), row);
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::rpc_account_sys)
