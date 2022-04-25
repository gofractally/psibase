#include "token_sys.hpp"

#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace psibase;
using psio::const_view;

TID TokenSys::create(Precision precision, Quantity max_supply)
{
   // NOP
   return 0;
}

void TokenSys::mint(TID tokenId, Quantity amount, AccountNumber receiver)
{
   // NOP
}

void TokenSys::set(TID tokenId, uint8_t flag)
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

void TokenSys::recall(TID tokenId, AccountNumber from, Quantity amount, const_view<String> memo)
{
   // NOP
}

std::optional<TokenRecord> TokenSys::getToken(TID tokenId)
{
   // NOP
   return std::nullopt;
}

Quantity TokenSys::getBalance(TID tokenId, AccountNumber account)
{
   // NOP
   return 0;
}

bool TokenSys::isAutodebit(AccountNumber account)
{
   // NOP
   return false;
}

PSIBASE_DISPATCH(UserContract::TokenSys)