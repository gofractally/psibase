#[psibase::service(name = "subgroups")]
pub mod service {
    pub use psibase::fracpack;

    /// Function that determines which subgrouping solution is preferred based on specific criteria.
    /// Returns true if the new solution is preferred over the old solution.
    type PreferenceFunction = fn(new: &[u32], old: &[u32]) -> bool;

    /// Prefers groupings with the greatest minimum group size.
    /// Achieves by comparison based on lexicographical ordering.
    /// Returns true if new > old.
    fn greatest_minimum_preference(new: &[u32], old: &[u32]) -> bool {
        let mut new_sorted = new.to_vec();
        let mut old_sorted = old.to_vec();
        new_sorted.sort_unstable();
        old_sorted.sort_unstable();
        new_sorted > old_sorted
    }

    /// Finds a valid partition of `n` into groups of `allowed` sizes, using a preference function
    /// to discriminate between alternative valid solutions.
    ///
    /// Requirements for the preference function:
    /// 1. It must define a strict weak ordering for partitions of each total size, up to n.
    /// 2. Adding the same group to two partitions must not change the result of is_preferred.
    ///
    /// Parameters
    /// * `n` - The number to partition (population)
    /// * `allowed` - Vector of allowed group sizes
    /// * `is_preferred` - Function that determines which solution is preferred
    ///
    /// Returns:
    /// * `Some(Vec<u32>)` - A valid partition of `n` using allowed group sizes.
    ///                      When >1 solutions exist for the same population size,
    ///                      returns the solution preferred according to `is_preferred`
    /// * `None` - No valid partition exists
    fn partition(n: u32, allowed: &Vec<u32>, is_preferred: PreferenceFunction) -> Option<Vec<u32>> {
        let mut solutions = vec![None; (n as usize) + 1];

        // Base case: for population 0, the solution is an empty vector
        solutions[0] = Some(vec![]);

        // Build solutions from bottom up, from 0 to the total population size
        for i in 1..=n {
            for &group in allowed.iter() {
                if group > i {
                    continue;
                }

                // Check if we have a solution for the remaining population
                if let Some(s) = &solutions[(i - group) as usize] {
                    let mut new = s.clone();
                    new.push(group);

                    // Use a dynamic preference function to determine which solution is better
                    if let Some(current) = &solutions[i as usize] {
                        if is_preferred(&new, current) {
                            solutions[i as usize] = Some(new);
                        }
                    } else {
                        solutions[i as usize] = Some(new);
                    }
                }
            }
        }

        solutions[n as usize].clone()
    }

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
    #[action]
    fn gmp(population: u32, allowed_groups: Vec<u32>) -> Option<Vec<u32>> {
        let mut allowed = allowed_groups.clone();
        allowed.dedup();
        allowed.sort_unstable();
        partition(population, &allowed, greatest_minimum_preference)
    }
}

#[cfg(test)]
mod tests;
