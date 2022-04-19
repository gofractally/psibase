#pragma once

#include <psio/fracpack.hpp>
#include <string>
#include "tables.hpp"

namespace UserContract
{
   class NftEvents
   {
     public:
      void minted(NID nftId, psibase::AccountNumber issuer) {}
      void burned(NID nftId) {}
      void disabledAutodebit(psibase::AccountNumber account) {}
      void enabledAutodebit(psibase::AccountNumber account) {}
      void credited(NID                           nftId,
                    psibase::AccountNumber        sender,
                    psibase::AccountNumber        receiver,
                    psio::const_view<std::string> memo)
      {
      }
      void transferred(NID                           nftId,
                       psibase::AccountNumber        sender,
                       psibase::AccountNumber        receiver,
                       psio::const_view<std::string> memo)
      {
      }
      void uncredited(NID                           nftId,
                      psibase::AccountNumber        sender,
                      psibase::AccountNumber        receiver,
                      psio::const_view<std::string> memo)
      {
      }
   };
   // clang-format off
   PSIO_REFLECT(NftEvents,
      method(minted, nftId, issuer),
      method(burned, nftId),
      method(disabledAutodebit, account),
      method(enabledAutodebit, account),
      method(credited, nftId, sender, receiver, memo),
      method(transferred, nftId, sender, receiver, memo),
      method(uncredited, nftId, sender, receiver, memo)
   );
   // clang-format on

}  // namespace UserContract