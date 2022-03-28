#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   // TODO: move to table instead of fixed value
   constexpr account_num rpc_contract_num = 3;  // RPC requests run on this contract

   struct verify_data
   {
      eosio::checksum256 transaction_hash;
      psibase::claim     claim;
      std::vector<char>  proof;
   };
   EOSIO_REFLECT(verify_data, transaction_hash, claim, proof)

   struct rpc_request_data
   {
      std::string       host;
      std::string       configured_host;
      std::string       method;
      std::string       target;
      std::vector<char> body;
   };
   EOSIO_REFLECT(rpc_request_data, host, configured_host, method, target, body)

   struct rpc_reply_data
   {
      std::string       content_type;
      std::vector<char> reply;
   };
   EOSIO_REFLECT(rpc_reply_data, content_type, reply)

}  // namespace psibase
