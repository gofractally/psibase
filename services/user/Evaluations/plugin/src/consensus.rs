use average::Variance;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt::{Debug, Display};
use std::hash::Hash;

fn get_max_variance<T: PartialEq + Copy + Eq + Hash>(
    lists: &Vec<Vec<T>>,
    unique_elements: &HashSet<T>,
) -> f64 {
    let half = lists.len() / 2;
    let remaining = lists.len() - half;
    let max_value = unique_elements.len() - 1;

    let mut vec = Vec::with_capacity(lists.len());
    vec.extend(std::iter::repeat(0.0).take(half));
    vec.extend(std::iter::repeat(max_value as f64).take(remaining));
    vec.iter().collect::<Variance>().population_variance()
}

#[derive(Clone, Default, Debug)]
struct ElementStats {
    indices: Vec<usize>,
    mean: f64,
    variance: f64,
    alignment_term: f64,
    final_score: f64,
}

struct AlignmentMerge<'a, T: PartialEq + Copy + Eq + Hash + Display + Debug> {
    pub lists: &'a Vec<Vec<T>>,
    max_variance: f64,
    elements: HashMap<T, ElementStats>,
    pub result: Option<Vec<T>>,
}

impl<'a, T: PartialEq + Copy + Eq + Hash + Display + Debug> AlignmentMerge<'a, T> {
    pub fn new(lists: &'a Vec<Vec<T>>) -> Self {
        let unique_elements: HashSet<T> = lists.iter().flatten().copied().collect();
        let max_variance = get_max_variance(&lists, &unique_elements);
        let mut elements = HashMap::new();
        for element in unique_elements {
            elements.insert(element, ElementStats::default());
        }

        for list in lists {
            for element in list {
                let count = list.iter().filter(|&e| *e == *element).count();
                assert!(count == 1, "element [{}] is not unique in list", element);
            }
        }

        Self {
            lists,
            elements,
            max_variance,
            result: None,
        }
    }

    /// Returns the indices of an element across all lists. The last element listed in a given
    ///   list is always at the maximum index. Therefore if a list has fewer elements than the full
    ///   set of unique elements, the missing elements are all at index 0 and the listed elements
    ///   are shifted by an offset equal to the number of missing elements.
    fn get_indices(&self, element: &T) -> Vec<usize> {
        let nr_unique = self.elements.len();
        self.lists
            .iter()
            .filter_map(|list| {
                assert!(
                    list.len() <= nr_unique,
                    "Unique elements in list greater than unique across all lists."
                ); // Should never happen.
                let offset = nr_unique - list.len();

                let index = list.iter().position(|o| o == element);
                if let Some(index) = index {
                    Some(index + offset)
                } else {
                    Some(0)
                }
            })
            .collect()
    }

    fn calculate_stats(&mut self) {
        // If there is a tie between the scores of two elements, we break the tie by
        //   deterministically constructing a tiebreak seed from the input lists.
        let mut tiebreak_seed: u32 = 0;

        let get_alignment_term = |variance: f64| {
            let ratio = variance / self.max_variance;
            1.0 - ratio
        };

        // Get all indices for each element
        let indices: HashMap<_, _> = self
            .elements
            .keys()
            .map(|&element| (element, self.get_indices(&element)))
            .collect();

        // Calculate the stats for each element
        for (element, stats) in self.elements.iter_mut() {
            stats.indices = indices[element].clone();
            let stat = &stats
                .indices
                .iter()
                .map(|&x| x as f64)
                .collect::<Variance>();
            stats.mean = stat.mean();
            stats.variance = stat.population_variance();
            stats.alignment_term = get_alignment_term(stats.variance);
            stats.final_score = stats.mean * stats.alignment_term;

            tiebreak_seed = tiebreak_seed.wrapping_add((stats.alignment_term * 100.0) as u32);
        }

        // Sort elements by final_score
        let mut sorted_elements: Vec<(T, ElementStats)> =
            self.elements.iter().map(|(&k, v)| (k, v.clone())).collect();
        sorted_elements.sort_by(|a, b| {
            match a.1.final_score.partial_cmp(&b.1.final_score).unwrap() {
                Ordering::Equal => {
                    // Tiebreak-seed determines lexicographic or reverse-lexicographic ordering
                    let cmp = a.0.to_string().cmp(&b.0.to_string());
                    if tiebreak_seed % 2 == 0 {
                        cmp
                    } else {
                        cmp.reverse()
                    }
                }
                ordering => ordering,
            }
        });

        // Save sorted elements to result
        self.result = Some(
            sorted_elements
                .into_iter()
                .map(|(element, _)| element)
                .collect(),
        );
    }

    pub fn run(&mut self) {
        self.calculate_stats();
    }

    #[allow(dead_code)]
    pub fn print(&self) {
        println!("Lists: {}", self.lists.len());
        for list in self.lists {
            println!(
                "  {}",
                list.iter()
                    .map(|x| x.to_string())
                    .collect::<Vec<String>>()
                    .join(", ")
            );
        }
        println!("RESULT: {:?}", self.result);
        println!("Max variance: {}", self.max_variance);

        for (element, stats) in self.elements.iter() {
            println!("element {}:", element);
            println!("  indices        = {:?}", stats.indices);
            println!("  mean           = {}", stats.mean);
            println!("  variance       = {}", stats.variance);
            println!("  alignment_term = {}", stats.alignment_term);
            println!("  final_score    = {}", stats.final_score);
        }
    }
}

/// Merges the input lists such that the resulting list is a union of all elements
/// across all lists, in an order dictated by the strength of the consensus of the
/// position of an element between input lists.
///
/// If there is low alignment on a particular element, the resulting list will tend
/// to pull that element closer to the front of the list. Elements in the front of
/// the resulting list have a lower score.
///
/// If two elements tie when calculating their position, then the relative order of
///   the elements in the final list will be deterministic, but arbitrary. In this
///   case, the relative order is not related to the strength of the alignment on
///   the position of the elements in the input lists.
///
/// Parameters:
/// - `lists`: A list of lists of elements to merge. The elements within a list should
///            be unique. The order of the lists does not matter.
///
/// Returns:
/// - A list of elements all elements across the input lists, in an order that considers
///     the alignment on the position of an element between input lists.
pub fn alignment_merge<T: PartialEq + Copy + Eq + Hash + Display + Debug>(
    lists: &Vec<Vec<T>>,
) -> Option<Vec<T>> {
    if lists.len() == 1 {
        return Some(lists[0].clone());
    }

    let mut alignment_merge = AlignmentMerge::new(lists);
    alignment_merge.run();
    alignment_merge.result
}

#[cfg(test)]
mod tests {
    use average::assert_almost_eq;

    use super::*;

    const DEBUG_PRINT: bool = false;

    fn run_alignment_merge<T: PartialEq + Copy + Eq + Hash + Display + Debug>(
        lists: &Vec<Vec<T>>,
        print: bool,
    ) -> Option<Vec<T>> {
        let mut merge = AlignmentMerge::new(&lists);
        merge.run();
        if print {
            merge.print();
        }
        merge.result
    }

    #[test]
    fn indices() {
        let lists = vec![
            vec![2, 3, 4, 6], //
            vec![3, 2, 4, 6],
        ];
        let merge = AlignmentMerge::new(&lists);

        assert_eq!(merge.get_indices(&3), vec![1, 0]);
        // If an element is missing in a list, it should be shown at index 0
        assert_eq!(merge.get_indices(&7), vec![0, 0]);
    }

    #[test]
    fn shifted_indices() {
        let lists = vec![
            vec![1, 2, 3, 4], //
            vec![2, 3, 4, 5],
        ];
        let merge = AlignmentMerge::new(&lists);
        assert_eq!(merge.get_indices(&1), vec![1, 0]);
        assert_eq!(merge.get_indices(&2), vec![2, 1]);
        assert_eq!(merge.get_indices(&5), vec![0, 4]);
    }

    #[test]
    fn test_max_variance() {
        // Between two lists with five possible elements
        // The maximum spread for a given element between the lists would be
        //   index 0 and index 4 (aka [0,4])
        // Population variance for [0,4] is 4.0
        let lists = vec![vec![1, 2, 3, 4, 5], vec![1, 2, 3, 4, 5]];
        let merge = AlignmentMerge::new(&lists);
        assert_eq!(merge.max_variance, 4.0);

        // Between five lists with seven possible elements
        // Max variance set is [0,0,0,0,6,6,6]
        // Population variance = 8.64
        let lists = vec![
            vec![1, 2, 3, 4, 5, 6, 7],
            vec![1, 2, 3, 4, 5, 6, 7],
            vec![1, 2, 3, 4, 5, 6, 7],
            vec![1, 2, 3, 4, 5, 6, 7],
            vec![1, 2, 3, 4, 5, 6, 7],
        ];
        let merge = AlignmentMerge::new(&lists);
        assert_eq!(merge.max_variance, 8.64);

        // Between three lists with five possible elements
        // Max variance set is [0,0,4]
        // Population variance = 3.55
        let lists = vec![
            vec![1, 2, 3], //
            vec![1, 2, 3, 4],
            vec![1, 2, 3, 5],
        ];
        let merge = AlignmentMerge::new(&lists);
        assert_almost_eq!(merge.max_variance, 3.555555555, 0.00001);
    }

    #[test]
    fn perfect_alignment() {
        // When all lists are identical, the result is the same list
        assert_eq!(
            run_alignment_merge(
                &vec![
                    //
                    vec![1, 2, 3, 4, 5],
                    vec![1, 2, 3, 4, 5],
                ],
                DEBUG_PRINT
            ),
            Some(vec![1, 2, 3, 4, 5])
        );
    }

    #[test]
    fn tie_merge() {
        // This test is meant to show that a tie does not panic and its result is deterministic
        for _ in 0..100 {
            assert_eq!(
                run_alignment_merge(
                    &vec![
                        //
                        vec![1, 2, 3, 4, 5],
                        vec![2, 1, 3, 4, 5],
                    ],
                    false
                ),
                Some(vec![1, 2, 3, 4, 5])
            );
        }
    }

    #[test]
    fn test_controversial_pasta() {
        // This confirms that the algorithm penalizes highly controversial elements

        // Ranked in ascending order
        let favorite_foods = vec![
            vec!["pizza", "salad", "ice cream", "burger", "pasta"],
            vec!["pizza", "salad", "ice cream", "burger", "pasta"],
            vec!["pizza", "salad", "ice cream", "burger", "pasta"],
            vec!["pasta", "pizza", "salad", "ice cream", "burger"],
            vec!["pasta", "pizza", "salad", "ice cream", "burger"],
            vec!["pasta", "pizza", "salad", "ice cream", "burger"],
        ];
        assert_eq!(
            run_alignment_merge(&favorite_foods, DEBUG_PRINT),
            Some(vec!["pasta", "pizza", "salad", "ice cream", "burger"]) // Pasta in last place
        );
    }

    #[test]
    fn test_missing_fruits() {
        let fruits = vec![
            vec!["apple", "banana", "orange"], //
            vec!["banana", "orange", "apple", "grape"],
            vec!["apple", "orange", "banana", "cherry"],
        ];
        assert_eq!(
            run_alignment_merge(&fruits, DEBUG_PRINT),
            Some(vec!["grape", "cherry", "apple", "banana", "orange"])
        );
    }

    #[test]
    #[should_panic(expected = "element [rose] is not unique in list")]
    fn test_not_unique() {
        let flowers = vec![
            vec!["rose", "rose", "rose", "daisy", "tulip"],
            vec!["rose", "lily", "tulip", "daisy", "poppy"],
            vec!["rose", "lily", "tulip", "daisy", "poppy"],
        ];
        run_alignment_merge(&flowers, DEBUG_PRINT);
    }

    #[test]
    fn test_list_ordering() {
        // Verify that the order of the lists does not matter
        let lists = vec![
            vec![1, 2, 3], //
            vec![1, 2, 3, 4],
            vec![5, 3, 2, 1],
        ];
        let lists2 = vec![
            vec![1, 2, 3, 4], //
            vec![5, 3, 2, 1],
            vec![1, 2, 3],
        ];
        assert_eq!(
            run_alignment_merge(&lists, false),
            run_alignment_merge(&lists2, false)
        );
    }

    #[test]
    fn test_sample_runs() {
        // This test cannot fail, and simply runs a bunch of sample inputs
        //   to allow for subjective inspection of the output for sanity checks.

        let lists = vec![
            /*alice  */ vec!["bob", "charlie", "dan", "everett", "frank"],
            /*bob    */ vec!["alice", "charlie", "dan", "everett", "frank"],
            /*charlie*/ vec!["alice", "bob", "dan", "everett", "frank"],
            /*dan    */ vec!["alice", "bob", "charlie", "everett", "frank"],
            /*everett*/ vec!["alice", "bob", "charlie", "dan", "frank"],
            /*frank  */ vec!["alice", "bob", "charlie", "dan", "everett"],
        ];
        run_alignment_merge(&lists, DEBUG_PRINT);
        //RESULT: "alice", "bob", "charlie", "frank", "dan", "everett"
    }
}
