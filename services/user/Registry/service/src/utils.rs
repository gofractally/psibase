/// Increment the last character of a string. The characters must be ASCII,
/// and this function was only tested for lowercase letters, numbers, and dashes.
///
/// Example: "abc" -> "abd"
pub fn increment_last_char(s: String) -> String {
    let mut chars: Vec<char> = s.chars().collect();
    if let Some(last) = chars.last_mut() {
        *last = char::from_u32((*last as u32) + 1).unwrap_or(*last);
    }
    chars.into_iter().collect()
}
