#include <services/test/VerifyWithCall.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void VerifyWithCall::verifySys(Checksum256 transactionHash, Claim claim, std::vector<char> proof)
{
   if (!proof.empty())
   {
      auto nested = psio::from_frac<std::vector<Action>>(proof);
      for (const auto& action : nested)
      {
         call(action);
      }
   }
}

PSIBASE_DISPATCH(VerifyWithCall)
