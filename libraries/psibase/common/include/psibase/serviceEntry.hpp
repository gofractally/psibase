#pragma once

#include <psibase/Rpc.hpp>
#include <psibase/block.hpp>

namespace psibase
{
   static constexpr auto transactionServiceNum = AccountNumber("transact");
   static constexpr auto proxyServiceNum       = AccountNumber("x-http");

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

   Action makeVerify(const Checksum256&    transactionHash,
                     const Claim&          claim,
                     std::span<const char> proof);
   Action makeVerify(const SignedTransaction& trx,
                     const Checksum256&       transactionHash,
                     std::size_t              idx);
}  // namespace psibase
