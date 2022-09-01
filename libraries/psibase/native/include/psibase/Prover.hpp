#pragma once

#include <memory>
#include <span>
#include <vector>

namespace psibase
{
   struct Claim;
   struct Prover
   {
      virtual std::vector<char> prove(std::span<const char> data, const Claim&) const = 0;
   };

   /// Returns the result from the first Prover that returns a valid signature
   struct CompoundProver : Prover
   {
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      std::vector<std::shared_ptr<Prover>> provers;
   };

   /// Throws if it cannot produce a valid signature
   struct CheckedProver : Prover
   {
      CheckedProver(std::shared_ptr<Prover> next) : next(std::move(next)) {}
      std::vector<char>       prove(std::span<const char> data, const Claim& claim) const;
      std::shared_ptr<Prover> next;
   };

}  // namespace psibase
