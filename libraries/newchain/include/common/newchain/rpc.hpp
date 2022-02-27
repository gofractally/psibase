#pragma once

#include <newchain/block.hpp>

namespace newchain
{
   // TODO: move to table instead of fixed value
   constexpr account_num rpc_contract_num = 3;  // RPC requests run on this contract

   struct rpc_request_data
   {
      std::string       method;
      std::string       target;
      std::vector<char> body;
   };
   EOSIO_REFLECT(rpc_request_data, method, target, body)

   struct rpc_reply_data
   {
      std::string       content_type;
      std::vector<char> reply;
   };
   EOSIO_REFLECT(rpc_reply_data, content_type, reply)

}  // namespace newchain
