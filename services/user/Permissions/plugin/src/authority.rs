use crate::bindings;
use crate::errors::ErrorType;

use bindings::host::common::{
    client::{get_sender_app, my_service_account},
    types::Error,
};

pub fn verify_caller_is_this_app() -> Result<(), Error> {
    let requester = get_sender_app().app.unwrap();
    let this_plugin = my_service_account();
    if requester != this_plugin {
        return Err(ErrorType::InvalidRequester().into());
    } else {
        return Ok(());
    }
}
