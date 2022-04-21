#include "token_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace psibase;
using psio::const_view;

TID TokenSys::create(Precision precision, Quantity max_supply)
{
   // NOP
}

void TokenSys::mint(TID tokenId, Quantity amount, AccountNumber receiver)
{
   // NOP
}

void TokenSys::unrecallable(TID tokenId)
{
   // NOP
}

void TokenSys::burn(TID tokenId, Quantity amount)
{
   // NOP
}

void TokenSys::autodebit(bool enable)
{
   // NOP
}

void TokenSys::credit(TID tokenId, AccountNumber receiver, Quantity amount, const_view<String> memo)
{
   // NOP
}

void TokenSys::uncredit(TID                tokenId,
                        AccountNumber      receiver,
                        Quantity           amount,
                        const_view<String> memo)
{
   // NOP
}

void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, const_view<String> memo)
{
   // NOP
}

std::optional<TokenRecord> TokenSys::getToken(TID tokenId)
{
   // NOP
}

bool TokenSys::isAutodebit(AccountNumber account)
{
   // NOP
}

PSIBASE_DISPATCH(UserContract::TokenSys)