#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   // TODO: move to table instead of fixed value
   constexpr account_num rpc_contract_num =
       account_num("rpc");  // RPC requests run on this contract

   struct verify_data
   {
      Checksum256       transaction_hash;
      psibase::claim    claim;
      std::vector<char> proof;
   };
   PSIO_REFLECT(verify_data, transaction_hash, claim, proof)

   struct rpc_request_data
   {
      std::string       host;
      std::string       root_host;
      std::string       method;
      std::string       target;
      std::vector<char> body;
   };
   PSIO_REFLECT(rpc_request_data, host, root_host, method, target, body)

   struct rpc_reply_data
   {
      std::string       content_type;
      std::vector<char> reply;
   };
   PSIO_REFLECT(rpc_reply_data, content_type, reply)

}  // namespace psibase
