use psibase::AccountNumber;

pub enum TokenType {
    Number(u32),
    Symbol(AccountNumber),
}

pub fn token_id_to_number(token_id: String) -> u32 {
    match identify_token_type(token_id) {
        TokenType::Number(num) => num,
        TokenType::Symbol(account) => {
            crate::tables::tables::Token::get_by_symbol(account)
                .expect("token by symbol not found")
                .id
        }
    }
}

pub fn identify_token_type(token_id: String) -> TokenType {
    let first_char = token_id.chars().next().unwrap();

    if first_char.is_ascii_digit() {
        TokenType::Number(token_id.parse::<u32>().expect("invalid token ID number"))
    } else {
        TokenType::Symbol(AccountNumber::from(token_id.as_str()))
    }
}
