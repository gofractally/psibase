#pragma once

// build:
// cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=ON .. && make -j $(nproc)

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

      void init();

   /* utility functions */
      void triggerEvents(uint32_t max) {};

   /* Fractal creation and building */
      void createFractal(psibase::AccountNumber acct,
                                 std::string name,
                                 std::string mission,
                                 std::string language,
                                 std::string timezone);
      void inviteMember(psibase::AccountNumber account);

   /* Meetings */
      void proposeSchedule(WhatType dayOfWeek, WhatType frequency);
      void confSchedule();

      // Q: are we still doing this? Or using subjective random number from BP?
      void checkin(psibase::Checksum256 entropy) {};
      void revealEntropy(psio::const_view<psibase::String> entropyRevealMsg) {};

      void submitConsensus(const std::vector<psibase::AccountNumber> &ranks) {};
      void proposeRemove(psibase::AccountNumber member) {};

   /* Teams */
      void createTeam(const std::vector<psibase::AccountNumber> &members,
                  psibase::AccountNumber name);
      void proposeMember(psibase::AccountNumber teamName,
                  psibase::AccountNumber member) {};
      void confirmMember(psibase::AccountNumber team,
                  psibase::AccountNumber member) {};
      void proposeLead(psibase::AccountNumber member) {};
      void initLeave(psibase::AccountNumber member,
                  psibase::AccountNumber team) {};
      void proposeTransfer(psibase::AccountNumber member,
                  Quantity                          amount,
                  psio::const_view<psibase::String> memo) {};

   /* Social */
      void createPetition(psio::const_view<psibase::String> title,
                  const std::string& contents,
                  WhatType txid) {}; // Q: What's the process? broadcast a trx that requires the appropriate msig/auth and include the trxid here?

     private:
      tables db{contract};

      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(FractallySys,
      method(init),
      method(triggerEvents, max),
      method(createFractal, acct, name, mission, language, timezone),
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
      method(createPetition, title, contents, txid) // Q: What's the process? broadcast a trx that requires the appropriate msig/auth and include the trxid here?
    );
   // clang-format on

}  // namespace UserContract