#include <psibase/Prover.hpp>
#include <psibase/block.hpp>
#include <psio/to_json.hpp>
#include <stdexcept>

namespace psibase
{
   std::vector<char> CompoundProver::prove(std::span<const char> data, const Claim& claim) const
   {
      for (const auto& prover : provers)
      {
         auto result = prover->prove(data, claim);
         if (!result.empty())
         {
            return result;
         }
      }
      return {};
   }

   std::vector<char> CheckedProver::prove(std::span<const char> data, const Claim& claim) const
   {
      auto result = next->prove(data, claim);
      if (result.empty() && claim.service != AccountNumber{})
      {
         throw std::runtime_error("No key found for " + psio::convert_to_json(claim));
      }
      return result;
   }
}  // namespace psibase
