#include <psibase/serviceEntry.hpp>

namespace psibase
{
   Action makeVerify(const Checksum256&    transactionHash,
                     const Claim&          claim,
                     std::span<const char> proof)
   {
      return {.service = claim.service,
              .method  = MethodNumber{"verifySys"},
              .rawData = psio::to_frac(std::tie(transactionHash, claim, proof))};
   }

   Action makeVerify(const SignedTransaction& trx,
                     const Checksum256&       transactionHash,
                     std::size_t              i)
   {
      auto claims = trx.transaction->claims();
      assert(trx.proofs.size() == claims.size());
      assert(i < trx.proofs.size());
      return makeVerify(transactionHash, claims[i], trx.proofs[i]);
   }
}  // namespace psibase
