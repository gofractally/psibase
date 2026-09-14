use crate::errors::ErrorType;
use crate::query::{fetch_network_token, fetch_token};

pub struct SystemTokenInfo {
    pub id: u32,
    pub symbol: Option<String>,
    pub precision: u8,
}

pub fn get_system_token() -> Result<Option<SystemTokenInfo>, ErrorType> {
    let Some(sys_tid) = fetch_network_token::fetch_network_token()? else {
        return Ok(None);
    };

    let token = fetch_token::fetch_token(sys_tid)?;

    Ok(Some(SystemTokenInfo {
        id: token.id,
        symbol: token.symbol.map(|s| s.to_string()),
        precision: token.precision.value(),
    }))
}
