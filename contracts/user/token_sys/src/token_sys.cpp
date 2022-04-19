#include "token_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace psibase;

TID TokenSys::create(uint8_t precision, uint64_t max_supply)
{
   // NOP
}

void TokenSys::mint(TID tokenId, uint64_t amount, psibase::AccountNumber receiver)
{
   // NOP
}

void TokenSys::unrecallable(TID tokenId)
{
   // NOP
}

void TokenSys::burn(TID tokenId, uint64_t amount)
{
   // NOP
}

void TokenSys::autodebit(bool enable)
{
   // NOP
}

void TokenSys::credit(TID                           tokenId,
                      psibase::AccountNumber        receiver,
                      uint64_t                      amount,
                      psio::const_view<std::string> memo)
{
   // NOP
}

void TokenSys::uncredit(TID                           tokenId,
                        psibase::AccountNumber        receiver,
                        uint64_t                      amount,
                        psio::const_view<std::string> memo)
{
   // NOP
}

void TokenSys::debit(TID                           tokenId,
                     psibase::AccountNumber        sender,
                     uint64_t                      amount,
                     psio::const_view<std::string> memo)
{
   // NOP
}

std::optional<TokenRecord> TokenSys::getToken(TID tokenId)
{
   // NOP
}

bool TokenSys::isAutodebit(psibase::AccountNumber account)
{
   // NOP
}

PSIBASE_DISPATCH(UserContract::TokenSys)