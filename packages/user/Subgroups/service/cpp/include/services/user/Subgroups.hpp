#pragma once

#include <psibase/psibase.hpp>
#include <services/system/Transact.hpp>

namespace UserService
{
   struct SubgroupsService
   {
      static constexpr auto service = psibase::AccountNumber("subgroups");

      /// This action runs an algorithm that could be called, "greatest minimum partition".
      ///
      /// It returns a vector of subgroupings that sum to the total population, where
      /// each subgrouping has a size that is allowed by the allowed_groups parameter,
      /// and with a grouping preference that maximizes the size of the smallest subgroup.
      ///
      /// For example, with a population of size 10, and allowed_groups = [4,5,6], one valid way
      /// to construct groups would be: [4, 6]. But the optimal way according to this algorithm
      /// would be: [5,5]. This is because the minimum partition in the first case is 4, and in
      /// the second case it is 5, and this algorithm tries to find the greatest minimum partition.
      ///
      /// Parameters:
      /// * `population` - The total population to partition
      /// * `allowed_groups` - A vector of allowed group sizes
      ///
      /// Returns:
      /// * `Some(Vec<u32>)` - A valid partition of the population into allowed group sizes.
      /// * `None` - No valid partition exists
      std::optional<std::vector<uint32_t>> gmp(uint32_t              population,
                                               std::vector<uint32_t> allowed_groups);
   };
   PSIO_REFLECT(SubgroupsService, method(gmp, population, allowed_groups));

}  // namespace UserService
