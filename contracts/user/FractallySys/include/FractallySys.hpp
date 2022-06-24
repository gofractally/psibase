#pragma once

// build:
// cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_DEBUG_WASM=ON .. && make -j $(nproc)

#include <psibase/Contract.hpp>
#include <psibase/String.hpp>
#include <psibase/check.hpp>
#include <string>
// #include "symbol_tables.hpp"
#include "FractallyErrors.hpp"
#include "FractallyTables.hpp"
#include "types.hpp"

namespace UserContract
{

   class FractallySys : public psibase::Contract<FractallySys>
   {
     public:
   //    using tables                      = psibase::ContractTables<TokenTable_t,
   //                                           BalanceTable_t,
   //                                           SharedBalanceTable_t,
   //                                           TokenHolderTable_t,
   //                                           InitTable_t>;
      static constexpr auto contract    = psibase::AccountNumber("FractallySys");
      using WhatType = uint32_t;
   //    static constexpr auto sysToken    = TID{1};
   //    static constexpr auto sysTokenSym = SID{"PSI"};

      FractallySys(psio::shared_view_ptr<psibase::Action> action);

      void init();

   /* utility functions */
      void triggerEvents(uint32_t max) {};

   /* Meetings */
      void proposeSchedule(WhatType dayOfWeek, WhatType frequency) {};
      void confSchedule() {};

      void checkin(psibase::Checksum256 entropy) {};

      void revealEntropy(psio::const_view<psibase::String> entropyRevealKey) {};
      void submitConsensus(std::vector<psibase::AccountNumber> ranks) {};
      void proposeRemove(psibase::AccountNumber member) {};

   /* Teams */
      void create(std::vector<psibase::AccountNumber> members,
                  psio::const_view<psibase::String> name) {};
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
                  psio::const_view<psibase::String> contents,
                  WhatType txid) {}; // Q: What's the process? broadcast a trx that requires the appropriate msig/auth and include the trxid here?

   //   private:
   //    tables db{contract};

   //    void _checkAccountValid(psibase::AccountNumber account);
   //    bool _isSenderIssuer(TID tokenId);

   //   public:
   //    struct Events
   //    {
   //       using Account    = psibase::AccountNumber;
   //       using StringView = psio::const_view<psibase::String>;

   //       // clang-format off
   //       struct Ui  // History <-- Todo - Change back to History
   //       {
   //          void initialized() {}
   //          void created(TID tokenId, Account creator, Precision precision, Quantity maxSupply) {}
   //          void minted(TID tokenId, Account minter, Quantity amount, StringView memo) {}
   //          void burned(TID tokenId, Account burner, Quantity amount) {}
   //          void userConfSet(Account account, psibase::NamedBit_t flag, bool enable) {}
   //          void tokenConfSet(TID tokenId, Account setter, psibase::NamedBit_t flag, bool enable) {}
   //          void symbolMapped(TID tokenId, Account account, SID symbolId) {}
   //          //};

   //          //struct Ui
   //          //{
   //          void credited(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
   //          void uncredited(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
   //          //};

   //          //struct Merkle
   //          //{
   //          void transferred(TID tokenId, Account sender, Account receiver, Quantity amount, StringView memo) {}
   //          void recalled(TID tokenId, Account from, Quantity amount, StringView memo) {}
   //       };
   //    };
      // clang-format on
   };

   // clang-format off
   PSIO_REFLECT(FractallySys,
      method(init),
      method(triggerEvents, max),
      method(proposeSchedule, dayOfWeek, frequency),
      method(confSchedule),
      method(checkin, entropy),
      method(revealEntropy, entropyRevealKey),
      method(submitConsensus, ranks),
      method(proposeRemove, member),
      method(create, members, name),
      method(proposeMember, teamName, member),
      method(confirmMember, team, member),
      method(proposeLead, member),
      method(initLeave, member, team),
      method(proposeTransfer, member, amount, memo),
      method(createPetition, title, contents, txid) // Q: What's the process? broadcast a trx that requires the appropriate msig/auth and include the trxid here?
    );
   // PSIBASE_REFLECT_UI_EVENTS(FractallySys, // Change to history
   //    method(initialized),
   //    method(created, tokenId, creator, precision, maxSupply),
   //    method(minted, tokenId, minter, amount, memo),
   //    method(burned, tokenId, burner, amount),
   //    method(userConfSet, account, flag, enable),
   //    method(tokenConfSet, tokenId, setter, flag, enable),
   //    method(symbolMapped, tokenId, account, symbolId),
   // //);
   // //PSIBASE_REFLECT_UI_EVENTS(FractallySys, 
   //    method(credited, tokenId, sender, receiver, amount, memo),
   //    method(uncredited, tokenId, sender, receiver, amount, memo),
   // //);
   // //PSIBASE_REFLECT_MERKLE_EVENTS(FractallySys, 
   //    method(transferred, tokenId, sender, receiver, amount, memo),
   //    method(recalled, tokenId, from, amount, memo)
   // );
   // clang-format on

}  // namespace UserContract