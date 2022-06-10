#pragma once

#include <psibase/Rpc.hpp>
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
}  // namespace psibase
