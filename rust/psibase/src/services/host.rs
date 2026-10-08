/// The host app account. It serves host plugins and has no chain actions.
#[crate::service(name = "host", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {}
