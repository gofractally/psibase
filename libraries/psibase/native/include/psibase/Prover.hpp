#pragma once

#include <memory>
#include <span>
#include <vector>

namespace psibase
{
   struct Claim;
   struct ClaimKey;
   struct Prover
   {
      virtual std::vector<char> prove(std::span<const char> data, const Claim&) const = 0;
      // Returns true if the Prover should be removed from its parent
      virtual bool remove(const Claim&)              = 0;
      virtual void get(std::vector<Claim>&) const    = 0;
      virtual void get(std::vector<ClaimKey>&) const = 0;
   };

   /// Returns the result from the first Prover that returns a valid signature
   struct CompoundProver : Prover
   {
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      bool              remove(const Claim&);
      void              add(std::shared_ptr<Prover>);
      void              get(std::vector<Claim>&) const;
      void              get(std::vector<ClaimKey>&) const;
      std::vector<std::shared_ptr<Prover>> provers;
   };

   /// Throws if it cannot produce a valid signature
   struct CheckedProver : Prover
   {
      CheckedProver(std::shared_ptr<Prover> next) : next(std::move(next)) {}
      std::vector<char>       prove(std::span<const char> data, const Claim& claim) const;
      bool                    remove(const Claim&);
      void                    get(std::vector<Claim>&) const;
      void                    get(std::vector<ClaimKey>&) const;
      std::shared_ptr<Prover> next;
   };

}  // namespace psibase
