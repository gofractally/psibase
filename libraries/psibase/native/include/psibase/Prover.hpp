#pragma once

#include <memory>
#include <psibase/block.hpp>
#include <vector>

namespace psibase
{
   struct Prover
   {
      virtual std::vector<char> prove(std::span<const char> data, const Claim&) const = 0;
   };

   struct CompoundProver : Prover
   {
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const
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
      std::vector<std::shared_ptr<Prover>> provers;
   };
}  // namespace psibase
