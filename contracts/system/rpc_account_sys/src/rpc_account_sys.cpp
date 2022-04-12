#include "contracts/system/rpc_account_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/proxy_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

static constexpr bool enable_print = false;

using table_num = uint16_t;
using namespace psibase;

static constexpr table_num web_content_table = 1;

inline auto webContentKey(AccountNumber thisContract, std::string_view path)
{
   return std::tuple{thisContract, web_content_table, path};
}
struct WebContentRow
{
   std::string       path        = {};
   std::string       contentType = {};
   std::vector<char> content     = {};

   auto key(AccountNumber thisContract) { return webContentKey(thisContract, path); }
};
PSIO_REFLECT(WebContentRow, path, contentType, content)

// TODO: automate defining the struct in reflection macro?
// TODO: out of date
struct CreateAccount
{
   psibase::AccountNumber account      = {};
   psibase::AccountNumber authContract = {};
   bool                   allowSudo    = false;
};
EOSIO_REFLECT(CreateAccount, account, authContract, allowSudo)
PSIO_REFLECT(CreateAccount, account, authContract, allowSudo)

namespace system_contract
{
   rpc_reply_data rpc_account_sys::serveSys(rpc_request_data request)
   {
      auto to_json = [](const auto& obj)
      {
         auto json = psio::convert_to_json(obj);
         return rpc_reply_data{
             .contentType = "application/json",
             .reply       = {json.begin(), json.end()},
         };
      };

      if (request.method == "GET")
      {
         auto content = kv_get<WebContentRow>(webContentKey(get_receiver(), request.target));
         if (!!content)
         {
            return {
                .contentType = content->contentType,
                .reply       = content->content,
            };
         }

         if (request.target == "/accounts")
         {
            std::vector<account_row> rows;
            auto                     key     = eosio::convert_to_key(account_key({}));
            auto                     keySize = sizeof(account_table);
            while (true)
            {
               auto raw = kv_greater_equal_raw(account_row::kv_map, key, keySize);
               if (!raw)
                  break;
               auto acc = psio::convert_from_frac<account_row>(*raw);
               key      = get_key();
               key.push_back(0);
               rows.push_back(std::move(acc));
            }
            return to_json(rows);
         }
      }

      if (request.method == "POST")
      {
         // TODO: move to an ABI wasm?
         if (request.target == "/pack/create_account")
         {
            request.body.push_back(0);
            eosio::json_token_stream jstream{request.body.data()};
            CreateAccount            args;
            eosio::from_json(args, jstream);
            check(args.account.value, "Invalid or missing name");
            check(args.authContract.value, "Invalid or missing authContract");
            action act{
                .sender   = account_sys::contract,
                .contract = account_sys::contract,
                .method   = "newAccount"_m,
                .raw_data = psio::convert_to_frac(args),
            };
            return to_json(act);
         }
      }

      abort_message_str("not found");
   }  // rpc_account_sys::proxy_sys

   void rpc_account_sys::uploadSys(psio::const_view<std::string>       path,
                                   psio::const_view<std::string>       contentType,
                                   psio::const_view<std::vector<char>> content)
   {
      check(get_sender() == get_receiver(), "wrong sender");

      // TODO
      auto              size = content.size();
      std::vector<char> c(size);
      for (size_t i = 0; i < size; ++i)
         c[i] = content[i];

      // TODO: avoid copies before pack
      WebContentRow row{
          .path        = path,
          .contentType = contentType,
          .content     = std::move(c),
      };
      kv_put(row.key(get_receiver()), row);
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::rpc_account_sys)
