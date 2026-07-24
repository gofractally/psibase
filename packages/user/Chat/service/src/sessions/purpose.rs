use super::types::{SessionError, PURPOSE_AV_CALL, PURPOSE_CHAT_DATA};

pub fn validate_purpose(purpose: &str) -> Result<(), SessionError> {
    if purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL {
        Ok(())
    } else {
        Err(SessionError::InvalidPurpose(format!(
            "unsupported session purpose: {purpose}"
        )))
    }
}
