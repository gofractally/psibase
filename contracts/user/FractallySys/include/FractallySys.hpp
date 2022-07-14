#pragma once

// build:
// setup build folder: cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_RUST=yes ..
// cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=ON .. && make -j $(nproc)
// with CCACHE: cmake -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_BUILD_TYPE=Release -DCMAKE_TARGET_MESSAGES=no -DBUILD_DEBUG_WASM=ON .. && make -j $(nproc)

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include <string>
#include "FractallyErrors.hpp"
#include "FractallyTables.hpp"
#include "types.hpp"

namespace UserContract
{

   class FractallySys : public psibase::Contract<FractallySys>
   {
     public:
      using tables                      = psibase::ContractTables<FractalsTable_t,
                                             TeamTable_t,
                                             BalanceTable_t>;
      static constexpr auto contract    = psibase::AccountNumber("fractally-sys");

      FractallySys(psio::shared_view_ptr<psibase::Action> action);

      typedef uint32_t teamTransferID;

      void init();

   /* utility functions */
      void triggerEvents(uint32_t max) {};

   /* Fractal creation and building */
      void createFractal(psibase::AccountNumber acct,
                                 std::string name,
                                 std::string mission,
                                 std::string language,
                                 std::string timezone);
      void setFracName(std::string name) {};
      void setFracMisn(std::string mission) {};
      void setFracLang(std::string lang) {};
      void setFracTZ(std::string timezone) {};
      void inviteMember(psibase::AccountNumber account);
      void enableCouncil() {};

   /* Meetings */
      void proposeSchedule(WhatType dayOfWeek, WhatType frequency);
      void confSchedule();

      // Q: are we still doing this? Or using subjective random number from BP?
      void checkin(psibase::Checksum256 entropy) {};
      void revealEntropy(psio::const_view<psibase::String> entropyRevealMsg) {};

      void submitConsensus(const std::vector<psibase::AccountNumber> &ranks) {};
      // Q: Do we want helper action like this that turn into msigs?
      //   Or will members create msigs directly from standard templates
      void proposeRemove(psibase::AccountNumber member) {};

   /* Teams */
      void createTeam(const std::vector<psibase::AccountNumber> &members,
                  psibase::AccountNumber name);
      void proposeMember(psibase::AccountNumber teamName,
                  psibase::AccountNumber member) {};
      void confirmMember(psibase::AccountNumber team,
                  psibase::AccountNumber member) {};
      void proposeLead(psibase::AccountNumber member) {};
      void initLeave(psibase::AccountNumber member, // Q: Allow this to be called for any member on the team
                  psibase::AccountNumber team) {};
      teamTransferID proposeTransfer(psibase::AccountNumber member,
                  Quantity                          amount,
                  psio::const_view<psibase::String> memo) {};
      void confTransfer(teamTransferID teamTransferID) {};

   /* Social */
      void createPetition(psio::const_view<psibase::String> title,
                  const std::string& contents,
                  WhatType txid) {}; // Q: What's the process? broadcast a trx that requires the appropriate msig/auth and include the trxid here?

   // Read-only interface:
      WhatType getFractal(psibase::AccountNumber name) {};

     private:
      tables db{contract};

     public:
      struct Events
      {
         // clang-format off
         struct Ui  // History <-- Todo - Change back to History
         {
            // Member
            void checkinStart() {}
            void entropySubm() {}
            void entrRvelStart() {}
            void meetingStart() {}
            void consensusSubm() {}
            void meetingEnd() {}
            void submissionsEnd() {}
            
            // Team
            void setTemLead() {}
            void addMember() {}
            void memberLeft() {}
            void TeamateRemoved() {}
            void teamXfer() {}

            // Council
            void scheduleUpdated() {}
            void memberEvicted(psibase::AccountNumber member) {}
            void petApproved(WhatType petitionID) {}
         };
      };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(FractallySys,
      method(init),
      method(triggerEvents, max),
      method(createFractal, acct, name, mission, language, timezone),
      method(setFracName, name),
      method(setFracMisn, mission),
      method(setFracLang, lang),
      method(setFracTZ, timezone),
      method(enableCouncil),
      method(inviteMember, account),
      method(proposeSchedule, dayOfWeek, frequency),
      method(confSchedule),
      method(checkin, entropy),
      method(revealEntropy, entropyRevealKey),
      method(submitConsensus, ranks),
      method(proposeRemove, member),
      method(createTeam, members, name),
      method(proposeMember, teamName, member),
      method(confirmMember, team, member),
      method(proposeLead, member),
      method(initLeave, member, team),
      method(proposeTransfer, member, amount, memo),
      method(confTransfer, teamTransferID),
      method(createPetition, title, contents, txid), // Q: What's the process? broadcast a trx that requires the appropriate msig/auth and include the trxid here?
      method(getFractal, name)
    );
   PSIBASE_REFLECT_UI_EVENTS(FractallySys, // Change to history
      // Member
      method(checkinStart),
      method(entropySubm),
      method(entrRvelStart),
      method(meetingStart),
      method(consensusSubm),
      method(meetingEnd),
      method(submissionsEnd),
      //Team
      method(setTemLead),
      method(addMember),
      method(memberLeft),
      method(TeamateRemoved),
      method(teamXfer),
      // Council
      method(scheduleUpdated),
      method(memberEvicted),
      method(petApproved, petitionID)
   );
   // clang-format on

}  // namespace UserContract