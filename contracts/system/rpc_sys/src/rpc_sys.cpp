#include <contracts/system/rpc_sys.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
#include "contracts/system/account_sys.hpp"

static constexpr bool enable_print = false;

namespace psibase
{
   using table_num = uint32_t;

   static constexpr table_num registered_contract_table = 1;

   inline auto registered_contract_key(account_num this_contract, account_num contract)
   {
      return std::tuple{this_contract, registered_contract_table, contract};
   }
   struct registered_contract_row
   {
      account_num contract     = {};
      account_num rpc_contract = {};

      auto key(account_num this_contract)
      {
         return registered_contract_key(this_contract, contract);
      }
   };
   EOSIO_REFLECT(registered_contract_row, contract, rpc_contract)

   void rpc_sys::register_contract(account_num contract, account_num rpc_contract)
   {
      check(contract == get_sender(), "wrong sender");
      registered_contract_row row{
          .contract     = contract,
          .rpc_contract = rpc_contract,
      };
      kv_put(row.key(get_receiver()), row);
   }
}  // namespace psibase

PSIBASE_DISPATCH(psibase::rpc_sys)

namespace psibase
{
   // TODO: move to another contract
   struct augmented_account_row : account_row
   {
      std::optional<std::string> name;
      std::optional<std::string> auth_contract_name;
   };
   EOSIO_REFLECT(augmented_account_row, base account_row, name, auth_contract_name)

   extern "C" [[clang::export_name("rpc")]] void rpc()
   {
      auto act = get_current_action();
      auto req = eosio::convert_from_bin<rpc_request_data>(act.raw_data);

      auto to_json = [](const auto& obj) {
         auto json = eosio::format_json(obj);
         set_retval(rpc_reply_data{
             .content_type = "application/json",
             .reply        = {json.begin(), json.end()},
         });
      };

      if (req.host.size() > req.configured_host.size() + 1 &&
          req.host.ends_with(req.configured_host) &&
          req.host[req.host.size() - req.configured_host.size() - 1] == '.')
      {
         std::string contract_name{req.host.begin(),
                                   req.host.end() - req.configured_host.size() - 1};

         // TODO: remove lookup after account number type is changed
         psibase::actor<account_sys> asys(act.contract, account_sys::contract);
         auto                        account_num = asys.get_account_by_name(contract_name).unpack();
         check(!!account_num, "unknown contract");

         auto reg =
             kv_get<registered_contract_row>(registered_contract_key(act.contract, *account_num));
         check(!!reg, "contract not registered");

         // TODO: avoid repacking (both directions)
         psibase::actor<rpc_interface> iface(act.contract, reg->rpc_contract);
         set_retval(iface.rpc_sys(req).unpack());
      }

      // TODO: move elsewhere
      if (req.method == "GET" && req.target == "/psiq/status")
      {
         auto status = kv_get<status_row>(status_row::kv_map, status_key());
         return to_json(*status);
      }

      // TODO: move elsewhere
      if (req.method == "GET" && req.target == "/psiq/accounts")
      {
         actor<account_sys> asys(act.contract, account_sys::contract);
         // TODO: don't stop on deleted accounts
         std::vector<augmented_account_row> rows;
         for (account_num i = 1;; ++i)
         {
            auto acc = kv_get<account_row>(account_row::kv_map, account_key(i));
            if (!acc)
               break;
            augmented_account_row aug;
            (account_row&)aug      = *acc;
            aug.name               = asys.get_account_by_num(aug.num);
            aug.auth_contract_name = asys.get_account_by_num(aug.auth_contract);
            rows.push_back(std::move(aug));
         }
         return to_json(rows);
      }

      abort_message("Unknown endpoint");
   }  // rpc()

}  // namespace psibase
