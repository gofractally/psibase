use async_graphql::ComplexObject;
use psibase::{check, check_some, services::tokens::Quantity, AccountNumber, Table};

use crate::{
    constants::PPM,
    tables::tables::{Config, Fractal, FractalMember, Levy, LevyTable, RewardStream},
};

impl Levy {
    fn new(
        fractal: AccountNumber,
        member: AccountNumber,
        payee: AccountNumber,
        rate_ppm: u32,
        amount: Quantity,
        send_to_stream: bool,
    ) -> Self {
        Self {
            id: Config::next_levy_id(),
            fractal,
            member,
            payee,
            rate_ppm,
            debt: amount,
            send_to_stream,
        }
    }

    pub fn add(
        fractal: AccountNumber,
        member: AccountNumber,
        payee: AccountNumber,
        ppm: u32,
        amount: Quantity,
        send_to_stream: bool,
    ) -> Self {
        check(ppm > 0 && ppm <= PPM, "ppm must be between 1 - 1,000,000");
        check_some(
            FractalMember::get(fractal, member),
            "cannot levy a non-member",
        );

        let total_existing_levy_ppm = Self::levies_of_member(fractal, member)
            .into_iter()
            .fold(0 as u32, |acc, levy| acc + levy.rate_ppm);

        check(
            total_existing_levy_ppm + ppm <= PPM,
            "accumulated levy ppms breach 100%",
        );

        let new_instance = Self::new(fractal, member, payee, ppm, amount, send_to_stream);

        new_instance.save();
        new_instance
    }

    pub fn get(fractal: AccountNumber, member: AccountNumber, id: u32) -> Option<Self> {
        LevyTable::read().get_index_pk().get(&(fractal, member, id))
    }

    pub fn get_assert(fractal: AccountNumber, member: AccountNumber, id: u32) -> Self {
        check_some(Self::get(fractal, member, id), "levy does not exist")
    }

    pub fn levies_of_member(fractal: AccountNumber, member: AccountNumber) -> Vec<Self> {
        LevyTable::read()
            .get_index_pk()
            .range((fractal, member, 0)..=(fractal, member, u32::MAX))
            .collect()
    }

    pub fn delete_by_exile(&self) {
        self.remove();
    }

    fn remove(&self) {
        LevyTable::read_write().remove(&self);
    }

    /// Applies the configured levy to the given income, pays the payee, and returns the amount levied.
    pub fn apply_levy(&mut self, gross_income: Quantity) -> Quantity {
        if gross_income.value == 0 {
            return gross_income;
        }
        let uncapped_amount: Quantity = (((gross_income.value as u128)
            .saturating_mul(self.rate_ppm as u128)
            .saturating_div(PPM as u128)
            .min(u64::MAX as u128)) as u64)
            .into();

        // Determine how much they can actually pay based on remaining amount.
        let payment = if self.debt.value > 0 {
            let amount = self.debt.min(uncapped_amount);
            let balance_after = self.debt - amount;

            if balance_after.value > 0 {
                self.debt = balance_after;
                self.save();
            } else {
                self.remove();
            }
            amount
        } else {
            uncapped_amount
        };

        if payment.value > 0 {
            let memo = "Levy payment".into();
            if self.send_to_stream {
                RewardStream::get_assert(self.fractal, self.payee).deposit(payment, memo);
            } else {
                psibase::services::tokens::Wrapper::call().credit(
                    Fractal::get_assert(self.fractal).token_id,
                    self.payee,
                    payment,
                    memo,
                );
            }
        }
        payment
    }

    fn save(&self) {
        LevyTable::read_write().put(&self).expect("failed to save");
    }
}

#[ComplexObject]
impl Levy {
    pub async fn fractal(&self) -> Fractal {
        Fractal::get_assert(self.fractal)
    }

    pub async fn fractal_member(&self) -> FractalMember {
        FractalMember::get_assert(self.fractal, self.member)
    }
}
