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
      psibase::TimePointSec creationDate;

      bool isActive()
      {
         /* Team active/inactive flag */
        // TODO: isActive can be computation based on max 12 queries for members being full-time
         return true;
      }
   };
   PSIO_REFLECT(TeamRecord,
               members,
               lead,
               rankRollingTotal,
               earningsRollingTotal,
               weeksOnCouncil,
               creationDate);
   using TeamTable_t = psibase::Table<TeamRecord, &TeamRecord::account>;
   // // Todo - add symbolId as secondary index when possible

   struct BalanceKey_t
   {
      psibase::AccountNumber account;
      TID                    tokenId;
   };
   PSIO_REFLECT(BalanceKey_t, tokenId, account);

   struct BalanceRecord
   {
      BalanceKey_t key;
      uint64_t     balance;
   };
   PSIO_REFLECT(BalanceRecord, key, balance);
   using BalanceTable_t = psibase::Table<BalanceRecord, &BalanceRecord::key>;

   struct FractalRecord
   {
      psibase::AccountNumber account;
      std::string name;
      std::string mission;
      // language: leaving this a string so it can be specified however a community wants
      //   (rather than imposing the ISO standard on them)
      std::string language;
      // timezone: also left general so a region of the world or a group of island
      //   or similar speaking people can label themselves as they wish
      std::string timezone;
      psibase::TimePointSec creationDate;
   };
   PSIO_REFLECT(FractalRecord,
               account,
               name,
               mission,
               language,
               timezone,
               creationDate);
   using FractalsTable_t = psibase::Table<FractalRecord, &FractalRecord::account>;
   /*
    * Petitions
    * How do we list Petitions? index msigs by auth?
    */
   
   // TODO: Events
   // - index member rank so we can pull rank history and calculate averages

}  // namespace UserContract