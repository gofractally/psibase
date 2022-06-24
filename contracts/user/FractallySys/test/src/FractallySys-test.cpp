#define CATCH_CONFIG_MAIN

// run a specific test
// cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=ON .. && make -j $(nproc) && ./psitest nft_sys-test-debug.wasm -s -r compact

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
constexpr std::string_view AN_EMPTY_CHAIN = "a default chain";
// TODO: add billing note where applicable and assert on the specific amount of resources (to notice when resource costs change)

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
   GIVEN(AN_EMPTY_CHAIN)
   {
      WHEN("There is no meeting scheduled") {
         THEN("The meeting cadence and day of week + time can be set") { }
      }
      WHEN("A meeting is scheduled") {
         THEN("The meeting happens at the set time") { }
         THEN("The meeting cadence cannot be changed (by a non-Council member)") { }
         THEN("The meeting cadence and day of the week can be changed by an Council consensus") {
            // TODO: Tests around Council changing cadence, day/time
         }
      }
   }
}

SCENARIO("Pre-meeting member activities") {
   GIVEN("a default chain with a meeting scheduled") {
      WHEN("an hour and 1 minute before the meeting") {
         THEN("member can't check in to the meeting") { }
      }
      WHEN("An hour before the meeting") {
         THEN("member can check in to participate in the meetings and submit entropy") { }
      }
      WHEN("After the meeting start time") {
         THEN("member can't check in to the meeting") { }
      }
      WHEN("member has checked in") {
         AND_WHEN("the meeting has started") {
            THEN("member can reveal their entropy") { }
         }
         AND_WHEN("1:59 minutes into the meeting") {
            THEN("member can reveal their entropy") { }
         }
         AND_WHEN("2:00 minutes into the meeting") {
            THEN("member can no longer reveal their entropy") { }
         }
      }
      WHEN("Member has checked in and revealed entropy") {
         AND_WHEN("meeting has been in progress for > 2:00 minutes") {
            THEN("Meeting starts on time and includes the member.") { }
         }
      }
      WHEN("meeting has been in progress for > 2:00 minutes") {
         WHEN("Member has not checked in and revealed entropy") {
            THEN("Meeting starts on time and does not include the member.") { }
         }
         WHEN("Member has checked in but not revealed entropy") {
            THEN("Meeting starts on time and does not include the member.") { }
         }
      }
      WHEN("Each checked-in member is grouped into a random meetings") {
         // anything to do about verifying random seed for randomizing members into meetings?
         THEN("Every checked-in member is in a meeting") { }
         THEN("No non-checked-in member is in a meeting") { }
         THEN("No member is in more than 1 meeting") { }
      }
   }
}

SCENARIO("In-meeting activities") {
   GIVEN("A default chain with an active meeting with 5 members and no consensus reports submitted yet") {
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

   GIVEN("A default chain") {
      // Q: minimum number of consensus submissions?
      AND_GIVEN("6 members in a meeting") {
         WHEN("All members submit consensus reports that agree") {
            THEN(CONSENSUS_ACHIEVED) { }
         }
         WHEN("4 of 6 members submit consensus reports that agree, and 1 report that does not agree") {
            THEN(CONSENSUS_ACHIEVED) { }
         }
         WHEN("4 of 6 members submit consensus reports that agree and include 2 unranked members") {
            THEN(CONSENSUS_ACHIEVED) {
               // algo needs to allow 2 unranked members to have either order and still count as reports in consensus
            }
         }
         WHEN("3 of 6 members submit consensus reports that agree, and 3 submit consensus reports that does not agree") {
            THEN(CONSENSUS_NOT_ACHIEVED) { }
         }
         WHEN("none of the members submit a consensus report") {
            THEN(CONSENSUS_NOT_ACHIEVED) { }
         }
      }
      AND_GIVEN("5 members in a meeting") {
         WHEN("All reports submit consensus reports that agree") {
            THEN(CONSENSUS_ACHIEVED) { }
         }
         WHEN("3 of 5 members submit consensus reports that agree, and 1 report that does not agree") {
            THEN(CONSENSUS_ACHIEVED) { }
         }
         WHEN("2 of 5 members submit consensus reports that agree, and 3 reports that do not agree (and differ)") {
            THEN(CONSENSUS_NOT_ACHIEVED) { }
         }
      }
      AND_GIVEN("4 members in a meeting") {
         WHEN("All members submit consensus reports that agree") {
            THEN(CONSENSUS_ACHIEVED) { }
         }
         WHEN("3 of 4 members submit consensus reports that agree, and 1 report that does not agree") {
            THEN(CONSENSUS_ACHIEVED) { }
         }
         WHEN("2 of 4 members submit consensus reports that agree, and 3 reports that do not agree (and differ)") {
            THEN(CONSENSUS_NOT_ACHIEVED) { }
         }
      }
      AND_GIVEN("3 members in a meeting") {
         // Consensus is defined as 3/5 or 4/6 *only*, requiring a minimum of 3 participants in a 5-member room and 4 in a 6-member room to meet the minimum
         // No one earns *anything* without at least these minima of consensus reports submitted
         WHEN("All members submit consensus reports that agree") {
            THEN(CONSENSUS_NOT_ACHIEVED) { }
         }
      }
      AND_GIVEN("a member who has submitted out-of-consensus reports for 4 weeks in a row") {
         WHEN("they submit their 5th out-of-consensus report (in the last 10 weeks)") {
            THEN(MEMBER_IS_EVICTED) { }
         }
      }
      AND_GIVEN("A new member who has never attended a meeting") {
         WHEN("they submit their 1st consensus report in line with the consensus") {
            THEN("they becomes an active member (out of pending status)") { }
         }
      }
      AND_GIVEN("A member who has attended 7 meetings and joined a team") {
         WHEN("they submit their 8th consensus report") {
            THEN("they become a full-time member, earning their team the team-matching reward for that week") { }
         }
      }
      // TODO: handle Full-time and part-time member thresholds being cross
      // TODO: handle team being active/inactive based on reent team attendance
      //    requires 4 FT members to be active
   }
}

SCENARIO("Meeting Attendance Accounting") {
   GIVEN("An default chain with a history of >3 meetings") {
      WHEN("A member joins a meeting after 3 weeks of absence") {
         THEN("they are immediately be credited 15% of their escrowed balance") {
            // Q: Can we make this consistent by using a 5%/wk distribution with a final threshold, below which remaining balance is credited?
            // amortization schedule that works out to 20 periods?
         }
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
         THEN("Servicer is paid 1% of all Respect distributed") { }
         THEN("Distributions to each member are doubled if they're on a team") { }
      }
   }
}

SCENARIO("Funds are distributed to members in a meeting") {
   WHEN("There are 6 members in a meeting, who all submit identical consensus reports") {
      THEN("Distributions are as follows: 21, 13, 8, 5, 3, 2") { }
   }
   WHEN("There are 6 members in a meeting, 5 of whom submit identical consensus reports") {
      // Alice, Bob, Carol, David, Erik, Freddy
      THEN("Distributions are as follows: 21, 13, 8, 5, 3") { }
      THEN("Erik doesn't receive any respect.") { }
   }
}

// TODO: more rounds? Higher numbers? We should plan for this either way, knowing that how many rounds should be configurable?

SCENARIO("Attendance stats and their impact") {
   GIVEN("A community less than 7000 members and a member who has missed 11 consecutive meetings") {
      WHEN("The member misses their 12th meeting") {
         THEN(MEMBER_IS_EVICTED) { }
      }
   }
   GIVEN("A community with 7000 weekly active members and a member who has missed 5 consecutive meetings") {
      WHEN("The member misses their 6th meeting") {
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
   GIVEN("an existing member who needs an account recovery") {
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
   GIVEN("4 full-time members not already on a team") {
      // White paper says "Any active member may start a new team and ask others to join. Once a team has 4 members it can select a team leader with 2⁄3 approval".
      // Any reason to allow people to form a team before they have 4 people? It's just extra logic for us if we allow it, impacting
      // . not issuing team rewards until 4 members,
      // . only enabling Council participation once 4 members
      // 2 main concerns
      // . code complexity
      // . members forming a lone team or a team of 2 simply to double their rewards, without actually having enough members to get the leverage we want from team collaboration and coordination
      THEN("They can create a new team") { }
   }
   GIVEN("A team with 4 full-time members and no leader") {
      THEN("They can add a new member with 2/3 agreement + the new member's agreement") { }
      THEN("They can't add a new member with less than 2/3 agreement + the new member's agreement") { }
      THEN("They can't add a new member with 2/3 agreement if the new member doesn't agree") { }
      // TODO: the other permutations of the vote
      // NOTE: do all can't cases, then end with can case, which sets up next WHEN / GIVEN chunk
      // TODO: "they" --> Alice? a FT member?
      THEN("They can't re-add a member already on the team") { }
      THEN("They can elect a team leader with 2/3 agreement") { } // Q: and the team lead's agreement?
      THEN("They can't elect a team leader without 2/3 agreement") { } // Q: and the team lead's agreement?
      THEN("They can't create another team") { }
      THEN("They can't join another team") { }
      WHEN("They elect to leave the team") {
         THEN("They are put in pending status to leave the team") { }
         
      }
   }
   GIVEN("A team with 4 full-time members and a team lead") {
      THEN("They can replace the team leader with 2/3 agreement") { } // Q: and the new team lead's agreement?

   }
   GIVEN("A team with 12 full-time members, one of whom has opted to leave the team and is in pending status") {
      THEN("The team can't add a new person") { } // TODO: Wrong
      THEN("The team remains active (and receives its team matching of member rewards") { }
      WHEN("12 weeks have passed") {
         THEN("The member who left the team can join a new team") { }
         THEN("The team (now 3) becomes inactive") { }
         THEN("The team can add a new full-time member.") {
            AND_THEN("The team becomes active again") { }
         }
      }
   }
      
   // TODO: If a team falls below four Full-Time Members, the team is no longer considered active and does not gain any team benefits,
   //   such as consideration for placement on the Council or matching Respect token distributions.
   //   If the team falls to zero Full-Time Members, the team is disbanded and all outstanding team escrow is deleted.
   GIVEN("A team with a token balance") {
      THEN("A member can propose and the team can sign a transaction to transfer from the team's token balance to a member's escrow account") { }
      THEN("A member can not propose a transaction to transfer from the team's token balance to a non-member's escrow account") { } // Q: yes?
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
         // Q: A member who's in process of leaving the team remains a full team members as long as they're behavior is good.
         // Q: Does their vote count in team decisions generally? ie. should it count in the 2/3 consensus calculation?
         //    many more questions about this. See technical doc for more questions
         //    Yes, they're a Full team member until they're off the team (or not a FT member)
   }
   GIVEN("A team of 1 member") {
      WHEN("The last member leaves the team") {
         THEN("The team gets auto-disbanded") { } // Q: do they have to wait the same leaving-a-team delay? Or is this immediate?
      }
   }
   WHEN("One member is absent for 5 weeks") {
      THEN("The team becomes inactive") { }
      AND_WHEN("The member is present for the next 7 meetings") {
         THEN("The team is still inactive") { }
      }
      AND_WHEN("The member is present for the 8th consecutive meeting") {
         THEN("The team becomes active again") { }
      }
   }


   GIVEN("An active team with 12 members") {
      WHEN("A member opts to leave the team") {
         THEN("The team can't add a new person.") { }
         AND_WHEN("12 weeks pass") {
            THEN("The member who left can join another team") { }
            THEN("The team can add a new person.") { }
         }
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

// TODO: non-member actions