#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   static constexpr auto rpcContractNum = AccountNumber("rpc-sys");

   struct verify_data
   {
      Checksum256       transaction_hash;
      Claim             claim;
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
      std::string       contentType;
      std::vector<char> reply;
   };
   PSIO_REFLECT(rpc_reply_data, contentType, reply)

}  // namespace psibase
