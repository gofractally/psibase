#[psibase::service(name = "subgroups")]
pub mod service {
    pub use psibase::fracpack;
    use std::collections::HashMap;

    /// # Description
    ///
    /// Recursive function that finds a valid partition of `n` into groups with sizes from `allowed`
    /// Uses memoization to avoid redundant calculations
    ///
    /// Parameters
    /// * `n` - The number to partition (remaining population)
    /// * `allowed` - Vector of allowed group sizes
    /// * `memo` - Memoization table to cache results for subproblems
    ///
    /// Returns:
    /// * `Some(Vec<u32>)` - A valid partition of `n` using allowed group sizes
    /// * `None` - No valid partition exists
    ///
    /// # Partition Algorithm Example
    ///
    /// This visualization walks through the recursive partition algorithm with memoization
    /// for finding a valid partition of a number into allowed group sizes.
    ///
    /// ## Example: `partition(14, [6,5,4], {})`
    ///
    /// Call Tree for partition(14, [6,5,4], {}):
    ///
    /// ```
    /// partition(14)
    /// |-- try group=6
    /// |   |-- partition(8)
    /// |   |   |-- try group=6
    /// |   |   |   |-- partition(2) ❌ (no valid partition)
    /// |   |   |-- try group=5
    /// |   |   |   |-- partition(3) ❌ (no valid partition)
    /// |   |   |-- try group=4
    /// |   |   |   |-- partition(4)
    /// |   |   |   |   |-- try group=6 ❌ (too large)
    /// |   |   |   |   |-- try group=5 ❌ (too large)
    /// |   |   |   |   |-- try group=4
    /// |   |   |   |   |   |-- partition(0) ✅ returns []
    /// |   |   |   |   |   |-- memo[4] = [4]
    /// |   |   |   |   |-- returns [4]
    /// |   |   |   |-- memo[8] = [4,4]
    /// |   |   |-- returns [4,4]
    /// |   |-- memo[14] = [6,4,4]
    /// |   |-- returns [6,4,4]
    /// |-- Found valid partition: [6,4,4]
    /// ```
    ///
    /// ## Memo Table Evolution:
    ///
    /// | State | memo |
    /// |-------|------|
    /// | Initial | `{}` |
    /// | After `partition(0)` | `{}` (base case, no update) |
    /// | After `partition(4)` | `{4: [4]}` |
    /// | After `partition(8)` | `{4: [4], 8: [4,4]}` |
    /// | After `partition(14)` | `{4: [4], 8: [4,4], 14: [6,4,4]}` |
    ///
    /// ## Result:
    /// The partition algorithm returns `[6,4,4]` for input `partition(14, [6,5,4], {})`.
    fn partition(
        n: u32,
        allowed: &Vec<u32>,
        memo: &mut HashMap<u32, Option<Vec<u32>>>,
    ) -> Option<Vec<u32>> {
        // Base case: nothing left to partition
        if n == 0 {
            return Some(vec![]);
        }

        // Check cache to avoid redundant calculations
        if memo.contains_key(&n) {
            return memo.get(&n).unwrap().clone();
        }

        // Try each allowed group size
        for &group in allowed.iter() {
            if group <= n {
                // Recursively find a valid partition for the remaining population
                if let Some(mut res) = partition(n - group, allowed, memo) {
                    // Found a valid subpartition, add current group to it
                    res.insert(0, group);

                    // Cache the result
                    memo.insert(n, Some(res.clone()));

                    return Some(res);
                }
            }
        }

        // No valid partition found for n, still cache this result
        memo.insert(n, None);
        None
    }

    /// # Description
    ///
    /// This action runs an algorithm that could be called, "greatest minimum partition".
    ///
    /// It returns a vector of subgroupings that sum to the total population, where
    /// each subgrouping has a size that is allowed by the allowed_groups parameter,
    /// and where the optimal strategy is to maximize the size of the smallest subgroup.
    ///
    /// For example, with a population of size 10, and allowed_groups = [4,5,6], one valid way
    /// to construct groups would be: [4, 6]. But the optimal way according to this algorithm
    /// would be: [5,5]. This is because the minimum partition in the first case is 4, and in
    /// the second case it is 5, and this algorithm tries to find the greatest minimum partition.
    ///
    /// Two alternative group constructions that have equivalent greatest minimum partitions,
    /// (e.g. [6,4,4] [5,5,4] ) are considered equivalent. In such a case, this implementation will
    /// secondarily prefer the group construction with the greatest maximum partition. (e.g. [6,4,4])
    ///
    /// Parameters:
    /// * `population` - The total population to partition
    /// * `allowed_groups` - A vector of allowed group sizes
    ///
    /// Returns:
    /// * `Some(Vec<u32>)` - A valid partition of the population into allowed group sizes
    /// * `None` - No valid partition exists
    ///
    /// # GMP Algorithm Visualization
    ///
    /// ## Example: `gmp(14, [4,5,6])`
    ///
    /// ```
    /// Step 1: Sort and deduplicate allowed_groups
    /// s_allowed_groups = [4,5,6]
    ///
    /// Step 2: Iterate through s_allowed_groups in reverse order
    /// First iteration: g = 6
    /// |-- allowed = [6]
    /// |-- partition(14, [6], {})
    /// |-- No valid partition found
    ///
    /// Second iteration: g = 5
    /// |-- allowed = [6,5]
    /// |-- partition(14, [6,5], {})
    /// |-- No valid partition found
    ///
    /// Third iteration: g = 4
    /// |-- allowed = [6,5,4]
    /// |-- partition(14, [6,5,4], {})
    /// |-- Returns [6,4,4]
    ///
    /// Result: [6,4,4]
    /// ```
    ///
    #[action]
    fn gmp(population: u32, allowed_groups: Vec<u32>) -> Option<Vec<u32>> {
        let mut s_allowed_groups = allowed_groups.clone();
        s_allowed_groups.sort();
        s_allowed_groups.dedup();

        for &g in s_allowed_groups.iter().rev() {
            let mut allowed: Vec<u32> =
                allowed_groups.iter().cloned().filter(|&s| s >= g).collect();
            allowed.sort_by(|a, b| b.cmp(a));
            if let Some(partition) = partition(population, &allowed, &mut HashMap::new()) {
                return Some(partition);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests;

/* Saving compute with memoization
partition(20, [8,5,3], {})
|-- try group=8
|   |-- partition(12)
|   |   |-- try group=8
|   |   |   |-- partition(4)
|   |   |   |   |-- try group=8 ❌
|   |   |   |   |-- try group=5 ❌
|   |   |   |   |-- try group=3 ❌
|   |   |   |   |-- memo[4] = None
|   |   |   |-- No valid partition
|   |   |-- try group=5
|   |   |   |-- partition(7)
|   |   |   |   |-- try group=8 ❌
|   |   |   |   |-- try group=5 ❌
|   |   |   |   |-- try group=3
|   |   |   |   |   |-- partition(4) ❌ lookup in memo returns None
|   |   |   |   |-- No valid partition
...
*/
