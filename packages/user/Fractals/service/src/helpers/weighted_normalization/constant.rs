pub fn constant<T>(items: Vec<T>) -> Vec<(T, u64)> {
    items.into_iter().map(|item| (item, 1)).collect()
}
