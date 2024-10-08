#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/block.hpp>

namespace psibase
{
   static constexpr auto transactionServiceNum = AccountNumber("transact");
   static constexpr auto proxyServiceNum       = AccountNumber("http-server");

   struct ProcessTransactionArgs
   {
      psio::shared_view_ptr<Transaction> transaction;
      bool                               checkFirstAuthAndExit;
      PSIO_REFLECT(ProcessTransactionArgs, transaction, checkFirstAuthAndExit)
   };

   struct VerifyArgs
   {
      Checksum256       transactionHash;
      Claim             claim;
      std::vector<char> proof;
      PSIO_REFLECT(VerifyArgs, transactionHash, claim, proof)
   };
}  // namespace psibase
