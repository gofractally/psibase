mod create_managed_account;

pub use create_managed_account::create_managed_account;
use psibase::AccountNumber;

pub fn donation_sub_account(fractal: AccountNumber) -> String {
    format!("{fractal}+donations")
}
