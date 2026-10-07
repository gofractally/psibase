mod create_managed_account;
mod link_fractal_core_plugin_deps;

use psibase::AccountNumber;

pub use create_managed_account::create_managed_account;
pub use link_fractal_core_plugin_deps::link_fractal_core_plugin_deps;

pub fn donation_sub_account(fractal: AccountNumber) -> String {
    format!("{fractal}+donations")
}
