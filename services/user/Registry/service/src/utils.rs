/// Increment the last character of a string. The characters must be ASCII,
/// and this function was only tested for lowercase letters, numbers, and dashes.
///
/// Example: "abc" -> "abd"
pub fn increment_last_char(s: String) -> String {
    let mut bytes = s.into_bytes();
    if let Some(last) = bytes.last_mut() {
        *last = *last + 1;
    }
    String::from_utf8(bytes).unwrap()
}
