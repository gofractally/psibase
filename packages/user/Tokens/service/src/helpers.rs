use psibase::AccountNumber;

pub enum TokenType {
    Number(u32),
    Symbol(AccountNumber),
}

pub fn identify_token_type(token_id: String) -> TokenType {
    let first_char = token_id.chars().next().unwrap();

    if first_char.is_ascii_digit() {
        TokenType::Number(token_id.parse::<u32>().expect("invalid token ID number"))
    } else {
        TokenType::Symbol(AccountNumber::from(token_id.as_str()))
    }
}

/// Formats a decimal amount string to a fixed precision.
///
/// This function ensures the fractional part has exactly `p` digits by right-padding with zeros
/// or truncating as needed. Leading zeros are removed from the integer part, except when the
/// integer part is "0".
///
/// The function:
/// 1. Splits the input into integer and fractional parts
/// 2. Removes leading zeros from the integer part (keeping at least "0")
/// 3. Right-pads or truncates the fractional part to exactly `p` digits
/// 4. Returns the formatted string: if `p` is 0, returns just the integer part; otherwise
///    returns "{integer}.{fractional}" with the fractional part having exactly `p` digits
///
/// Examples:
/// - `to_fixed("123.4", 2)` returns `"123.40"` (padded)
/// - `to_fixed("123.456", 2)` returns `"123.45"` (truncated)
/// - `to_fixed("123", 2)` returns `"123.00"` (padded)
/// - `to_fixed("00123.4", 2)` returns `"123.40"` (leading zeros removed)
/// - `to_fixed("000.5", 3)` returns `"0.500"` (keeps "0" for zero integer part)
/// - `to_fixed("123.4", 0)` returns `"123"` (no decimal point)
/// - `to_fixed("0.5", 3)` returns `"0.500"` (padded)
pub fn to_fixed(amount: &str, p: u8) -> String {
    let (i, f) = amount.split_once('.').unwrap_or((amount, ""));
    let i = i.trim_start_matches('0');
    let i = if i.is_empty() { "0" } else { i };
    let mut f = f.to_string();
    let pz = p as usize;
    if f.len() < pz {
        f.extend(std::iter::repeat('0').take(pz - f.len()));
    }
    let f = &f[..pz.min(f.len())];
    if pz == 0 {
        i.to_string()
    } else {
        format!("{i}.{f}")
    }
}
