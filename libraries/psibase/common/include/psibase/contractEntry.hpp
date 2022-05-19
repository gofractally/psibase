#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   static constexpr auto proxyContractNum = AccountNumber("proxy-sys");

   struct VerifyData
   {
      Checksum256       transactionHash;
      Claim             claim;
      std::vector<char> proof;
   };
   PSIO_REFLECT(VerifyData, transactionHash, claim, proof)

   struct RpcRequestData
   {
      std::string       host;
      std::string       rootHost;
      std::string       method;
      std::string       target;
      std::vector<char> body;
   };
   PSIO_REFLECT(RpcRequestData, host, rootHost, method, target, body)

   struct RpcReplyData
   {
      std::string       contentType;
      std::vector<char> body;
   };
   PSIO_REFLECT(RpcReplyData, contentType, body)

}  // namespace psibase
