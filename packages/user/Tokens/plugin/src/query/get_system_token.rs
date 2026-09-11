use crate::errors::ErrorType;
use crate::query::{fetch_network_token, fetch_token};

pub struct SystemTokenInfo {
    pub id: u32,
    pub symbol: String,
    pub precision: u8,
}

pub fn get_system_token() -> Result<Option<SystemTokenInfo>, ErrorType> {
    let Some(sys_tid) = fetch_network_token::fetch_network_token()? else {
        return Ok(None);
    };

    let token = fetch_token::fetch_token(sys_tid)?;
    let id = token.id;
    let symbol = token
        .symbol
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("ID: {id}"));

    Ok(Some(SystemTokenInfo {
        id,
        symbol,
        precision: token.precision.value(),
    }))
}
