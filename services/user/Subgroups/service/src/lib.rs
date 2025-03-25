#[psibase::service(name = "subgroups")]
pub mod service {
    pub use psibase::fracpack;

    /// Function that determines which subgrouping solution is preferred based on specific criteria.
    /// Returns true if the new solution is preferred over the old solution.
    type PreferenceFunction = fn(new: &[u32], old: &[u32]) -> bool;

    /// Preference function that compares based on the greatest minimum group size.
    /// If minimum values are equal, it compares based on maximum group size.
    fn greatest_minimum_preference(new: &[u32], old: &[u32]) -> bool {
        let old_min = old.iter().min().unwrap_or(&u32::MAX);
        let new_min = new.iter().min().unwrap_or(&u32::MAX);

        // Criterion 1: If the new minimum is greater than the old minimum
        let criterion1 = new_min > old_min;

        // Criterion 2: If the minimum values are equal, then prefer the solution
        // with the minimum number of groups at the minimum group size
        let criterion2 = new_min == old_min
            && new.iter().filter(|&x| x == new_min).count()
                < old.iter().filter(|&x| x == old_min).count();

        criterion1 || criterion2
    }

    /// Finds a valid partition of `n` into groups of `allowed` sizes
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
    /// If two alternative group constructions have equivalent greatest minimum partitions,
    /// (e.g. [6,4,4] [5,5,4] ), this implementation will prefer the grouping that minimizes the total
    /// number of groups with the minimum group size. (e.g. [5,5,4])
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
        allowed.sort();
        partition(population, &allowed, greatest_minimum_preference)
    }
}

#[cfg(test)]
mod tests;
