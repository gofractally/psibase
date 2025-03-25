#[crate::service(name = "subgroups", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
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
        unimplemented!()
    }
}
