#pragma once

#include <compare>
#include <limits>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>

// #include "nft_sys.hpp"
#include "../../token_sys/include/types.hpp"
#include "types.hpp"

namespace UserContract
{
   enum MemberStatus {
      FullTime = 0,
      PartTime = 1,
      Nonparticipating = 2
   };
   struct MemberRecord
   {
      psibase::AccountNumber account;
      std::time_t joinDate;
      MemberStatus status;
      float consensusRollingAvg; // 12-week rolling avg of coming to consensus
      uint16_t rankRollingTotal; // 12-week rolling total, calculated end of meetings
   };
   struct TeamRecord
   {
      psibase::AccountNumber account;
      // TODO: set const for max_team_size
      std::array<psibase::AccountNumber, 12> members;
      psibase::AccountNumber lead;
      uint16_t rankRollingTotal; // 12-week rolling total
      uint16_t earningsRollingTotal; // 12-week rolling total
      uint8_t weeksOnCouncil; // incremented or wiped EOD

      bool isActive()
      {
         /* Team active/inactive flag */
        // TODO: isActive can be computation based on max 12 queries for members being full-time
         return true;
      }

      auto operator<=>(const TeamRecord&) const = default;
   };
   PSIO_REFLECT(TeamRecord,
               members,
               lead,
               rankRollingTotal,
               earningsRollingTotal,
               weeksOnCouncil);
   using TeamTable_t = psibase::Table<TeamRecord, &TeamRecord::account>;
   // // Todo - add symbolId as secondary index when possible

   struct BalanceKey_t
   {
      psibase::AccountNumber account;
      TID                    tokenId;

      auto operator<=>(const BalanceKey_t&) const = default;
   };
   PSIO_REFLECT(BalanceKey_t, tokenId, account);

   struct BalanceRecord
   {
      BalanceKey_t key;
      uint64_t     balance;

      auto operator<=>(const BalanceRecord&) const = default;
   };
   PSIO_REFLECT(BalanceRecord, key, balance);
   using BalanceTable_t = psibase::Table<BalanceRecord, &BalanceRecord::key>;

   /*
    * Petitions
    * How do we list Petitions? index msigs by auth?
    */
   
   // TODO: Events
   // - index member rank so we can pull rank history and calculate averages

}  // namespace UserContract