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

   bool CompoundProver::remove(const Claim& claim)
   {
      provers.erase(
          std::remove_if(provers.begin(), provers.end(), [&](auto& p) { return p->remove(claim); }),
          provers.end());
      return false;
   }

   void CompoundProver::remove(const std::shared_ptr<Prover>& member)
   {
      std::erase(provers, member);
   }

   void CompoundProver::add(std::shared_ptr<Prover> prover)
   {
      provers.push_back(prover);
   }

   void CompoundProver::get(std::vector<Claim>& out) const
   {
      for (const auto& prover : provers)
      {
         prover->get(out);
      }
   }

   void CompoundProver::get(std::vector<ClaimKey>& out) const
   {
      for (const auto& prover : provers)
      {
         prover->get(out);
      }
   }

   FixedProver::FixedProver(const std::vector<char>& proof) : proof(proof) {}
   std::vector<char> FixedProver::prove(std::span<const char>, const Claim&) const
   {
      return proof;
   }
   bool FixedProver::remove(const Claim&)
   {
      return false;
   }
   void FixedProver::get(std::vector<Claim>&) const {}
   void FixedProver::get(std::vector<ClaimKey>&) const {}

   std::vector<char> CheckedProver::prove(std::span<const char> data, const Claim& claim) const
   {
      auto result = next->prove(data, claim);
      if (result.empty() && claim.service != AccountNumber{})
      {
         throw std::runtime_error("No key found for " + psio::convert_to_json(claim));
      }
      return result;
   }

   bool CheckedProver::remove(const Claim& claim)
   {
      return next->remove(claim);
   }

   void CheckedProver::get(std::vector<Claim>& out) const
   {
      return next->get(out);
   }

   void CheckedProver::get(std::vector<ClaimKey>& out) const
   {
      return next->get(out);
   }
}  // namespace psibase
