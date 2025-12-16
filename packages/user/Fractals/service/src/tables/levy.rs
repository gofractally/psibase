use async_graphql::ComplexObject;
use psibase::{check, check_some, services::tokens::Quantity, AccountNumber, Memo, Table};

use crate::{
    constants::PPM,
    tables::tables::{
        Config, Fractal, FractalMember, GuildMember, Levy, LevyTable, RewardConsensus,
    },
};

impl Levy {
    fn new(
        fractal: AccountNumber,
        member: AccountNumber,
        payee: AccountNumber,
        ppm: u32,
        amount: Option<Quantity>,
    ) -> Self {
        Self {
            id: Config::next_levy_id(),
            fractal,
            member,
            payee,
            ppm,
            remaining: amount,
        }
    }

    pub fn add(
        fractal: AccountNumber,
        member: AccountNumber,
        payee: AccountNumber,
        ppm: u32,
        amount: Option<Quantity>,
    ) -> Self {
        check(ppm > 0 && ppm <= PPM, "ppm must be between 1 - 1,000,000");

        let total_existing_levy_ppm = Self::levies_of_member(fractal, member)
            .into_iter()
            .fold(0 as u32, |acc, levy| acc + levy.ppm);

        check(
            total_existing_levy_ppm + ppm <= PPM,
            "accumulated levy ppms breach 100%",
        );

        let new_instance = Self::new(fractal, member, payee, ppm, amount);

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

    fn remove(&self) {
        LevyTable::read_write().remove(&self);
    }

    /// Applies the configured levy to the given income, pays the payee, and returns the amount paid.
    pub fn apply_levy(&mut self, gross_income: Quantity) -> Quantity {
        if gross_income.value == 0 {
            return gross_income;
        }
        let ppm_based_levy: Quantity = (((gross_income.value as u128)
            .saturating_mul(self.ppm as u128)
            .saturating_div(PPM as u128)
            .min(u64::MAX as u128)) as u64)
            .into();

        // Determine how much they can actually pay based on remaining amount.
        let payment = if let Some(remaining) = self.remaining {
            let capped_payment = remaining.min(ppm_based_levy);
            let debt_remaining = remaining - capped_payment;

            let is_debt_remaining = debt_remaining.value > 0;
            if is_debt_remaining {
                self.remaining = Some(debt_remaining);
                self.save();
            } else {
                self.remove();
            }
            capped_payment
        } else {
            ppm_based_levy
        };

        if payment.value > 0 {
            let memo = "Levy payment".into();
            if let Some(fractal_member) = FractalMember::get(self.fractal, self.payee) {
                fractal_member.credit_direct(payment, memo);
            } else {
                RewardConsensus::get_assert(self.payee).donate(payment, memo);
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

    pub async fn guild_member(&self) -> GuildMember {
        GuildMember::get_assert(self.fractal, self.member)
    }

    pub async fn fractal_member(&self) -> FractalMember {
        FractalMember::get_assert(self.fractal, self.member)
    }
}
