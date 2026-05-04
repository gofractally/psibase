use async_graphql::ComplexObject;
use async_graphql::{connection::Connection, SimpleObject};

use psibase::{check_none, check_some, AccountNumber, RawKey, Table, TableQuery};

use crate::{
    constants::{GUILD_APP_ENDORSEMENT_THRESHOLD, GUILD_APP_REJECT_THRESHOLD},
    tables::tables::{
        Guild, GuildApplication, GuildApplicationTable, GuildAttest, GuildAttestTable, GuildMember,
    },
};
use psibase::services::transact::Wrapper as TransactSvc;

enum ApplicationStatus {
    Accepted,
    Rejected,
    Pending,
}

impl GuildApplication {
    fn new(guild: AccountNumber, applicant: AccountNumber, extra_info: String) -> Self {
        let now = TransactSvc::call().currentBlock().time.seconds();

        Self {
            guild,
            applicant,
            extra_info,
            created_at: now,
        }
    }

    pub fn add(guild: AccountNumber, applicant: AccountNumber, extra_info: String) -> Self {
        check_some(Guild::get(guild), "guild does not exist");
        check_none(Self::get(guild, applicant), "application already exists");
        check_none(
            GuildMember::get(guild, applicant),
            "user is already a guild member",
        );
        let new_instance = Self::new(guild, applicant, extra_info);
        new_instance.save();
        new_instance
    }

    pub fn get(guild: AccountNumber, applicant: AccountNumber) -> Option<Self> {
        GuildApplicationTable::read()
            .get_index_pk()
            .get(&(guild, applicant))
    }

    pub fn get_assert(guild: AccountNumber, applicant: AccountNumber) -> Self {
        check_some(
            Self::get(guild, applicant),
            "guild application does not exist",
        )
    }

    pub fn set_extra_info(&mut self, extra_info: String) {
        self.extra_info = extra_info;
        self.save();
    }

    fn application_status(&self) -> ApplicationStatus {
        let mut score = 0i16;
        let mut acceptors: Vec<AccountNumber> = Vec::new();
        let mut rejectors: Vec<AccountNumber> = Vec::new();

        for attestation in GuildAttestTable::read().get_index_pk().range(
            (self.guild, self.applicant, AccountNumber::new(0))
                ..=(self.guild, self.applicant, AccountNumber::new(u64::MAX)),
        ) {
            if attestation.endorses {
                score += 1;
                acceptors.push(attestation.attester);
            } else {
                score -= 1;
                rejectors.push(attestation.attester);
            }
        }

        let auth = psibase::services::auth_dyn::Wrapper::call();

        if score >= (GUILD_APP_ENDORSEMENT_THRESHOLD as i16)
            || auth.isAuthSys(self.guild, acceptors, None, None)
        {
            ApplicationStatus::Accepted
        } else if score <= -(GUILD_APP_REJECT_THRESHOLD as i16)
            || auth.isAuthSys(self.guild, rejectors, None, None)
        {
            ApplicationStatus::Rejected
        } else {
            ApplicationStatus::Pending
        }
    }

    fn check_attests(&self) {
        match self.application_status() {
            ApplicationStatus::Accepted => {
                GuildMember::add(self.guild, self.applicant);
                self.remove()
            }
            ApplicationStatus::Rejected => {
                self.remove();
            }
            ApplicationStatus::Pending => {}
        }
    }

    fn attestations_score(&self) -> i16 {
        GuildAttestTable::read()
            .get_index_pk()
            .range(
                (self.guild, self.applicant, AccountNumber::new(0))
                    ..=(self.guild, self.applicant, AccountNumber::new(u64::MAX)),
            )
            .map(|e| if e.endorses { 1 } else { -1 })
            .sum()
    }

    pub fn attest(&self, comment: String, attester: AccountNumber, endorses: bool) {
        GuildAttest::set(self.guild, self.applicant, attester, comment, endorses);
        self.check_attests();
    }

    pub fn cancel(&self) {
        self.remove()
    }

    fn remove(&self) {
        let table = GuildAttestTable::read_write();

        table
            .get_index_pk()
            .range(
                (self.guild, self.applicant, AccountNumber::new(0))
                    ..=(self.guild, self.applicant, AccountNumber::new(u64::MAX)),
            )
            .for_each(|attest| {
                table.remove(&attest);
            });

        GuildApplicationTable::read_write().remove(&self);
    }

    fn save(&self) {
        GuildApplicationTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}

#[derive(SimpleObject)]
pub struct ApplicationScore {
    pub current: i16,
    pub required: i16,
}

#[ComplexObject]
impl GuildApplication {
    pub async fn guild(&self) -> Guild {
        Guild::get_assert(self.guild)
    }

    pub async fn attestations(
        &self,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, GuildAttest>> {
        TableQuery::subindex::<AccountNumber>(
            GuildAttestTable::read().get_index_pk(),
            &(self.guild, self.applicant),
        )
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
    }

    pub async fn score(&self) -> ApplicationScore {
        ApplicationScore {
            current: self.attestations_score(),
            required: GUILD_APP_ENDORSEMENT_THRESHOLD as i16,
        }
    }
}
