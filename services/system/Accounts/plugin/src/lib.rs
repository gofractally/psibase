#[allow(warnings)]
mod bindings;
mod db;
mod errors;
mod helpers;
mod interfaces;
mod plugin;

use plugin::AccountsPlugin;

bindings::export!(AccountsPlugin with_types_in bindings);
