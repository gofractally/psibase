#pragma once

#include <psibase/Prover.hpp>

namespace psibase
{

   struct BlockContext;
   struct VerifyProver : Prover
   {
      VerifyProver(BlockContext& bc, std::vector<char> proof) : bc(bc), proof(std::move(proof)) {}
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      BlockContext&     bc;
      std::vector<char> proof;
   };

}  // namespace psibase
