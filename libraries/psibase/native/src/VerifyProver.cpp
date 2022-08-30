#include <psibase/ActionContext.hpp>
#include <psibase/BlockContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/VerifyProver.hpp>
#include <psibase/contractEntry.hpp>

std::vector<char> psibase::VerifyProver::prove(std::span<const char> data, const Claim& claim) const
{
   if (claim.contract == AccountNumber{})
   {
      return {};
   }
   SignedTransaction  tx;
   TransactionTrace   trace;
   TransactionContext tc{bc, tx, trace, false, false, false};
   tc.execVerifyProof(sha256(data.data(), data.size()), claim, proof);
   return proof;
}
