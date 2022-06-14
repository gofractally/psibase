#define CATCH_CONFIG_MAIN

#include "FractallySys.hpp"
#include <contracts/system/commonErrors.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/testUtils.hpp>

using namespace psibase;
using namespace psibase::benchmarking;
using UserContract::FractallySys;
using namespace UserContract::Errors;
using namespace UserContract;

constexpr std::string_view MEMBER_IS_EVICTED = "member is removed from the community";

namespace
{
   constexpr bool storageBillingImplemented     = false;
   constexpr bool eventEmissionTestingSupported = false;

   struct DiskUsage_TokenRecord
   {
      static constexpr int64_t firstEmplace      = 100;
      static constexpr int64_t subsequentEmplace = 100;
      static constexpr int64_t update            = 100;
   };

   const psibase::String memo{"memo"};

   const std::vector<std::pair<AccountNumber, const char*>> neededContracts = {
       {FractallySys::contract, "FractallySys.wasm"}};

   constexpr auto manualDebit  = "manualDebit"_m;
   constexpr auto unrecallable = "unrecallable"_m;
   constexpr auto untradeable  = "untradeable"_m;

}  // namespace

SCENARIO("Scheduling meetings")
{
   GIVEN("a first-time deployed contract")
   {
      THEN("There is no meeting scheduled") {
         AND_THEN("The meeting cadence and day of week + time can be set") {
            AND_THEN("The meeting cadence cannot be changed (without the Council's say)") { }
            AND_THEN("The meeting happens at the set time") { }
            // TODO: Tests around Council changing cadence, day/time
         }
      }
   }
   GIVEN("an established meeting schedule and cadence")
   {
      THEN("The meeting cadence and day of week + time can be updated") { }
   }
}

SCENARIO("Pre-meeting user activities") {
   GIVEN("an hour and 1 minute before the meeting") {
      THEN("User can't check in to the meeting") { }
   }
   GIVEN("An hour before the meeting") {
      THEN("User can check in to participate in the meetings and submit a bit of entropy") { }
   }
   GIVEN("At meeting start time") {
      THEN("Participants can reveal their entropy") { }
   }
   GIVEN("2 minutes after the start of the meeting") {
      GIVEN("a participant who hasn't checked in and submitted entropy") {
         THEN("Meetings start on time and includes the user.") { }
      }
      GIVEN("a participant who hasn't checked in and submitted entropy") {
         THEN("Meetings start on time and does not include the user.") { }
      }
   }
   GIVEN("Each checked-in user is grouped into a random meetings") {
      // anything to do about verifying random seed for randomizing members into meetings?
      THEN("Every checked-in user is in a meeting") { }
      THEN("No non-checked-in user is in a meeting") { }
      THEN("No user is in more than 1 meeting") { }
   }
}

SCENARIO("In-meeting activities") {
   GIVEN("A meeting with 5 participants and no activity yet") {
      THEN("Alice can submit a consensus report") {
         AND_THEN("Alice cannot submit another consensus report") {}
      }
      WHEN("David is misbehaving in the meeting") {
         THEN("Alice, Bob, and Carol can vote to eject David for misbehaving") {}
      }
   }
}

SCENARIO("Meeting Attendance and Consensus") {
   constexpr std::string_view CONSENSUS_ACHIEVED = "funds are distributed only to those who were aligned on the consensus report";
   constexpr std::string_view CONSENSUS_NOT_ACHIEVED = "funds are *not* distributed";

   WHEN("There are no consensus reports submitted") {
      WHEN("There are no participants in a meeting") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
      WHEN("There are 6 participants in a meeting") {
        THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
   }
   WHEN("There are 6 participants in a meeting") {
      WHEN("All reports are in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("4 of 6 reports are in agreement, 1 not in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("4 of 6 reports are in agreement, and include 2 unranked members") {
         THEN(CONSENSUS_ACHIEVED) {
            // algo needs to allow 2 unranked members to have either order and still count as reports in consensus
         }
      }
      WHEN("3 of 6 reports are in agreement, 3 not in agreement (and differ)") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
      THEN("Servicer is paid 1% of all Respect distributed") { }
      THEN("Distributions to each member are doubled if they're on a team") { }
   }
   WHEN("There are 5 participants in a meeting") {
      WHEN("All reports are in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("3 of 5 reports are in agreement, 1 not in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("2 of 5 reports are in agreement, 3 not in agreement (and differ)") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
   }
   WHEN("There are 4 participants in a meeting") {
      WHEN("All reports are in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("3 of 4 reports are in agreement, 1 not in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("2 of 4 reports are in agreement, 3 not in agreement (and differ)") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
   }
   WHEN("There are 3 participants in a meeting") {
      WHEN("All reports are in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("2 of 3 reports are in agreement, 1 not in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("1 of 3 reports are in agreement, 3 not in agreement (and differ)") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
   }
   WHEN("There are 2 participants in a meeting") {
      WHEN("All reports are in agreement") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("1 of 2 reports are in agreement, 3 not in agreement (and differ)") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
   }
   WHEN("There is 1 participant in a meeting") {
      WHEN("Participant submits a report") {
         THEN(CONSENSUS_ACHIEVED) { }
      }
      WHEN("Participant does not submits a report") {
         THEN(CONSENSUS_NOT_ACHIEVED) { }
      }
   }
   WHEN("A member submits their 5th out-of-consensus report in the last 10 weeks") {
      THEN(MEMBER_IS_EVICTED) { }
   }
   WHEN("A member submits their 1st consensus report in line with the majority") {
      THEN("A new member becomes an active member (out of pending status)") { }
   }
}

SCENARIO("Meeting Attendance Accounting") {
   WHEN("A member joins a meeting after 3 weeks of absence") {
      THEN("they are immediately be credited 5% of their escrowed balance") { }
   }
   WHEN("The day's meetings have ended") {
      THEN("vote weight has been decreased by max(5%, 1) and increased by today's rank") { }
      THEN("a team lead's vote weight has been decreased by max(5%, 1) and increased by today's rank + 3") { }
      WHEN("Community's total rank earned is higher than 6% of total token supply") {
         THEN("Alice receives her rank in tokens") { }
      }
      WHEN("Community's total rank earned is less than 6% of total current token supply") {
         THEN("Alice receives her rank in tokens, scaled to ensure 6% token supply increase") { }
      }
      THEN("Bob's team earns an amount matching his earnings for the day") { }
      // Which reward pools in MVP? Sponsor?
      // What are we doing about recruitment?
         // We need to be tracking inviter when we do the invitation process
      THEN("Alice's weekly averages reflect updated values") { }
      WHEN("Carol has requested leaving a team, and 20 weeks have passed") {
         THEN("Carol is no longer on her team and can join a new team") { }
      }
      WHEN("20 week rank totals change who's in the top 12") {
         THEN("The Council shows the current top 12 earning teams (based on total rank of all member on a team)") { }
      }
   }
}

SCENARIO("Funds are distributed to participants in a meeting") {
   WHEN("There are 6 participants in a meeting, who all submit identical consensus reports") {
      THEN("Distributions are as follows: 21, 13, 8, 5, 3, 2") { }
   }
   WHEN("There are 6 participants in a meeting, 5 of whom submit identical consensus reports") {
      // Alice, Bob, Carol, David, Erik, Freddy
      THEN("Distributions are as follows: 21, 13, 8, 5, 3") { }
      THEN("Erik doesn't receive any respect.") { }
   }
}

// TODO: more rounds? Higher numbers? We should plan for this either way, knowing that how many rounds should be configurable?

SCENARIO("Attendance stats and their impact") {
   GIVEN("A community less than 7000 members and a user who has missed 11 consecutive meetings") {
      WHEN("The user misses their 12th meeting") {
         THEN(MEMBER_IS_EVICTED) { }
      }
   }
   GIVEN("A community with 7000 weekly active members and a user who has missed 5 consecutive meetings") {
      WHEN("The user misses their 6th meeting") {
         THEN(MEMBER_IS_EVICTED) { }
      }
   }
}

SCENARIO("Member management operations") {
   GIVEN("A current member") {
      THEN("That member can resign from the community") { }
   }
}

SCENARIO("Council's special rights") {
   GIVEN("A current member and the approval of 7 of the Council (of 12) to evict him") {
      THEN("Member is still active") { }
      GIVEN("The 8th Council member votes in the affirmative on the motion and 72 hours have passed") {
         THEN("The member is evicted") { }
      }
      GIVEN("A Team Leader changes, impacting the set of approvals necessary for Council approval") {
         WHEN("The formerly 12th (now only 11th) Council member votes in the affirmative") {
            THEN("Member is still active") { }
         }
         AND_THEN("The now 12th Council member votes in the affirmative") {
            THEN("The member is evicted") { }
         }
      }
   }
   GIVEN("an existing user who needs an account recovery") {
      THEN("A Council can't recover an account without an active recovery request.") { }
      THEN("Any member can stake respect and request the account recovery") {
         // Q: How much to stake here? Review our Account Recovery process from Eden
         AND_THEN("A council can recover the account with a 2/3 vote + review time") {
            // Q: or is this 8 votes? What if Council is smaller than 12 members? Fewer votes needed to reach consensus?
         }
      }
   }
}

SCENARIO("Petition Life Cycle") {
   // Q: Can we get away without Petitions in MVP? Would we could this as a viable MVP?
   GIVEN("A standing community") {
      THEN("Any member can post a petition for community review") { }
   }
}

SCENARIO("Team Administration") {
   WHEN("At least 4 people agree to be on a team") {
      // White paper says "Any active member may start a new team and ask others to join. Once a team has 4 members it can select a team leader with 2⁄3 approval".
      // Any reason to allow people to form a team before they have 4 people? It's just extra logic for us if we allow it, impacting
      // . not issuing team rewards until 4 members,
      // . only enabling Council participation once 4 members
      // 2 main concerns
      // . code complexity
      // . members forming a lone team or a team of 2 simply to double their rewards, without actually having enough members to get the leverage we want from team collaboration and coordination
      THEN("They can create a new team") {
         AND_THEN("They can add a new member with 2/3 agreement + the new member's agreement") { }
         GIVEN("A member already on a team") {
            THEN("They can't add that new member with 2/3 agreement + the new member's agreement") { }
         }
         AND_THEN("They can elect a team leader with 2/3 agreement") {
            AND_THEN("They can replace the team leader with 2/3 agreement") { }
         }
         GIVEN("A team token balance") {
            THEN("A member and propose and the team can sign a transaction to transfer from the team's token balance to a member's escrow account") { }
            THEN("A single vote + 72 hours auto-executes the trx") { }
            THEN("A 2/3 vote of all members auto-executes the trx") { }
            THEN("A 2/3 vote of some of the members + 72 hours auto-executes the trx") { }
            THEN("Less than 2/3 vote of member votes + 72 hours rejects the trx and penalizes the proposer") {
               // We need to talk about the penalty to the proposer. Given our stance on other issues,
               // I recommend we let the team set a penalty so that it's a team perogative,
               // rather than an over-specified detail we impose on them.
            }
            THEN("Team member can't propose a trx if they lack sufficient balance to pay the penalty in the case that the trx isn't approved by their team") { }
            THEN("A non-team member can't propose a trx against the team's token balance") { }
            THEN("A team member who plans to leave the team can't propose a trx against the team's token balance") {
               // Q: Agreed?
               // Q: Does their vote count in team decisions generally? ie. should it count in the 2/3 consensus calculation?
               // .  many more questions about this. See technical doc for more questions
            }
         }
      }
      THEN("They can't mark a member for removal") {
         // Q: They can't remove someone if it reduces them to 3, right? Does a team auto-disband at that point?
      }
   }
   WHEN("3 people agree to form a new team") {
      THEN("They can't create a new team") { }
   }
   WHEN("13 people agree to form a new team") {
      THEN("They can't create a new team") { }
   }
   GIVEN("A team of 12 people") {
      THEN("They can't add a new person") { }
      THEN("They can mark a member for removal") { }
   }
}