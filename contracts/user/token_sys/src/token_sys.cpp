#include "token_sys.hpp"
#include "errors.hpp"

#include <psibase/dispatch.hpp>

using namespace UserContract;
using namespace UserContract::Errors;
using namespace psibase;
using psio::const_view;

TID TokenSys::create(Precision precision, Quantity maxSupply)
{
   auto creator    = get_sender();
   auto tokenTable = db.open<TokenTable_t>();
   auto tokenIdx   = tokenTable.get_index<0>();

   // Todo - replace with auto incrementing when available
   TID newId = (tokenIdx.begin() == tokenIdx.end()) ? 1 : (*(--tokenIdx.end())).id + 1;

   check(TokenRecord::isValidKey(newId), invalidTokenId);

   auto nftId = at<NftSys>().mint();
   at<NftSys>().credit(nftId, creator, "Nft for new token ID: " + std::to_string(newId));

   tokenTable.put(TokenRecord{
       .id        = newId,      //
       .ownerNft  = nftId,      //
       .precision = precision,  //
       .maxSupply = maxSupply   //
   });

   emit().ui().created(newId, creator, precision, maxSupply);

   return newId;
}

void TokenSys::mint(TID tokenId, Quantity amount, AccountNumber receiver, const_view<String> memo)
{
   auto token = getToken(tokenId);
   auto nft   = at<NftSys>().getNft(token.ownerNft);

   check(nft->owner() == get_sender(), missingRequiredAuth);

   // Todo - Should mint like this? Directly updating user balance?
   // Check that current_supply + amount < max_supply and doesn't overflow
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

void TokenSys::recall(TID                tokenId,
                      AccountNumber      from,
                      AccountNumber      to,
                      Quantity           amount,
                      const_view<String> memo)
{
   // NOP
}

TokenRecord TokenSys::getToken(TID tokenId) const
{
   auto tokenTable = db.open<TokenTable_t>();
   auto tokenIdx   = tokenTable.get_index<0>();
   auto tokenOpt   = tokenIdx.get(tokenId);
   psibase::check(tokenOpt.has_value(), tokenDNE);

   return *tokenOpt;
}

Quantity TokenSys::getBalance(TID tokenId, AccountNumber account) const
{
   // NOP
   return 0;
}

Quantity TokenSys::getSharedBal(TID tokenId, AccountNumber creditor, AccountNumber debitor) const
{
   // NOP
   return 0;
}

bool TokenSys::isAutodebit(AccountNumber account) const
{
   // NOP
   return false;
}

PSIBASE_DISPATCH(UserContract::TokenSys)