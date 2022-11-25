#pragma once

#include <psibase/Prover.hpp>

namespace psibase
{

   struct BlockContext;
   struct VerifyProver : Prover
   {
      VerifyProver(BlockContext& bc, std::vector<char> proof) : bc(bc), proof(std::move(proof)) {}
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      virtual bool      remove(const Claim&) { return false; }
      virtual void      get(std::vector<Claim>&) const {}
      virtual void      get(std::vector<ClaimKey>&) const {}
      BlockContext&     bc;
      std::vector<char> proof;
   };

}  // namespace psibase
