#include <services/user/TokenSys.hpp>

#include <services/system/AccountSys.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/RTokenSys.hpp"
#include "services/user/SymbolSys.hpp"

using namespace UserService;
using namespace UserService::Errors;
using namespace psibase;
using psio::view;
using SystemService::AccountSys;
using SystemService::ServiceMethod;
using SystemService::TransactionSys;
using TokenHolderConfig = typename TokenHolderRecord::Configurations;

// For helpers
#include <concepts>
#include <limits>
namespace
{
   template <std::integral T>
   constexpr bool sumOverflows(T value1, T value2)
   {
      return std::numeric_limits<T>::max() - value2 < value1;
   }

   template <std::integral T>
   constexpr bool sumExceeds(T addend1, T addend2, T limit)
   {
      return sumOverflows(addend1, addend2) || addend1 + addend2 > limit;
   }

   namespace userConfig
   {
      constexpr auto manualDebit = psibase::EnumElement{"manualDebit"};
   }

   namespace tokenConfig
   {
      constexpr auto unrecallable = psibase::EnumElement{"unrecallable"};
      constexpr auto untradeable  = psibase::EnumElement{"untradeable"};
   }  // namespace tokenConfig

}  // namespace

TokenSys::TokenSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().getIndex<0>().get(SingletonKey{});
      check(initRecord.has_value(), uninitialized);
   }
}

void TokenSys::init()
{
   // Set initialized flag
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.getIndex<0>().get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   auto tokService = to<TokenSys>();
   auto nftService = to<NftSys>();

   // Configure manual debit for self on Token and NFT
   tokService.setUserConf(userConfig::manualDebit, true);
   nftService.setUserConf(userConfig::manualDebit, true);

   // Configure manual debit for Nft on Token
   std::tuple<EnumElement, bool> params{userConfig::manualDebit, true};
   Action                        setUsrConf{.sender  = NftSys::service,
                                            .service = TokenSys::service,
                                            .method  = "setUserConf"_m,
                                            .rawData = psio::convert_to_frac(params)};
   to<TransactionSys>().runAs(std::move(setUsrConf), std::vector<ServiceMethod>{});

   // Create system token
   auto tid = tokService.create(Precision{8}, Quantity{1'000'000'000e8});
   check(tid == TID{1}, wrongSysTokenId);

   // Make system token default untradeable
   tokService.setTokenConf(tid, tokenConfig::untradeable, true);

   // Pass system token ownership to symbol service
   auto tNft = getToken(tid).ownerNft;
   nftService.credit(tNft, SymbolSys::service, "Passing system token ownership");

   // Register proxy
   to<SystemService::ProxySys>().registerServer(RTokenSys::service);
}

TID TokenSys::create(Precision precision, Quantity maxSupply)
{
   auto creator    = getSender();
   auto tokenTable = Tables().open<TokenTable>();
   auto tokenIdx   = tokenTable.getIndex<0>();
   auto nftService = to<NftSys>();

   // Todo - replace with auto incrementing when available
   TID newId = (tokenIdx.begin() == tokenIdx.end()) ? 1 : (*(--tokenIdx.end())).id + 1;

   Precision::fracpack_validate(precision);  // Todo remove if/when happens automatically
   check(TokenRecord::isValidKey(newId), invalidTokenId);
   check(maxSupply.value > 0, supplyGt0);

   auto nftId = nftService.mint();
   if (creator != TokenSys::service)
   {
      nftService.credit(nftId, creator, "Nft for new token ID: " + std::to_string(newId));
   }

   auto eventHead = emit().history().created(0, newId, creator, precision, maxSupply);

   tokenTable.put(TokenRecord{
       .id        = newId,      //
       .ownerNft  = nftId,      //
       .precision = precision,  //
       .maxSupply = maxSupply,  //
       .eventHead = eventHead,  //
   });

   return newId;
}

void TokenSys::mint(TID tokenId, Quantity amount, view<const String> memo)
{
   auto sender  = getSender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(isSenderIssuer(tokenId), missingRequiredAuth);
   check(not sumExceeds(token.currentSupply.value, amount.value, token.maxSupply.value),
         maxSupplyExceeded);

   token.eventHead = emit().history().minted(token.eventHead, tokenId, sender, amount, memo);

   token.currentSupply += amount;
   balance.balance += amount.value;
   Tables().open<TokenTable>().put(token);
   Tables().open<BalanceTable>().put(balance);
}

void TokenSys::burn(TID tokenId, Quantity amount)
{
   auto sender  = getSender();
   auto token   = getToken(tokenId);
   auto balance = getBalance(tokenId, sender);

   check(amount.value > 0, quantityGt0);
   check(balance.balance >= amount.value, insufficientBalance);

   balance.balance -= amount.value;

   if (balance.balance == 0)
   {
      Tables().open<BalanceTable>().erase(BalanceKey{sender, tokenId});
   }
   else
   {
      Tables().open<BalanceTable>().put(balance);
   }

   auto holder      = getTokenHolder(sender);
   holder.eventHead = emit().history().burned(holder.eventHead, tokenId, sender, amount);
   token.eventHead  = emit().history().burned(token.eventHead, tokenId, sender, amount);

   Tables().open<TokenTable>().put(token);
   Tables().open<TokenHolderTable>().put(holder);
}

void TokenSys::setUserConf(psibase::EnumElement flag, bool enable)
{
   auto sender  = getSender();
   auto holder  = getTokenHolder(sender);
   auto flagBit = TokenHolderRecord::Configurations::value(flag);

   check(not holder.config.get(flagBit) == enable, redundantUpdate);

   holder.config.set(flagBit, enable);
   holder.eventHead = emit().history().userConfSet(holder.eventHead, sender, flag, enable);

   Tables().open<TokenHolderTable>().put(holder);
}

void TokenSys::setTokenConf(TID tokenId, psibase::EnumElement flag, bool enable)
{
   check(isSenderIssuer(tokenId), missingRequiredAuth);
   if (flag == tokenConfig::unrecallable)
   {
      check(enable, invalidConfigUpdate);
   }

   auto token     = getToken(tokenId);
   auto flagIndex = TokenRecord::Configurations::value(flag);

   token.eventHead =
       emit().history().tokenConfSet(token.eventHead, tokenId, getSender(), flag, enable);

   token.config.set(flagIndex, enable);
   Tables().open<TokenTable>().put(token);
}

void TokenSys::credit(TID tokenId, AccountNumber receiver, Quantity amount, view<const String> memo)
{
   auto sender      = getSender();
   auto balance     = getBalance(tokenId, sender);
   auto token       = getToken(tokenId);
   auto untradeable = getTokenConf(tokenId, tokenConfig::untradeable);

   check(sender != receiver, senderIsReceiver);
   check(amount.value > 0, quantityGt0);
   check(amount.value <= balance.balance, insufficientBalance);
   if (not isSenderIssuer(tokenId))
   {  // Token issuer may still distribute untradeable tokens
      check(untradeable == false, tokenUntradeable);
   }

   balance.balance -= amount.value;
   auto balanceTable = Tables().open<BalanceTable>();
   balanceTable.put(balance);

   auto manualDebitFlag = TokenHolderConfig::value(userConfig::manualDebit);
   bool manualDebitBit  = getTokenHolder(receiver).config.get(manualDebitFlag);
   if (manualDebitBit)
   {
      auto sharedBalance = getSharedBal(tokenId, sender, receiver);
      sharedBalance.balance += amount.value;
      Tables().open<SharedBalanceTable>().put(sharedBalance);
   }
   else
   {
      auto time            = to<TransactionSys>().currentBlock().time;
      auto receiverBalance = getBalance(tokenId, receiver);
      receiverBalance.balance += amount.value;
      Tables().open<BalanceTable>().put(receiverBalance);

      auto senderHolder      = getTokenHolder(sender);
      senderHolder.eventHead = emit().history().transferred(senderHolder.eventHead, tokenId, time,
                                                            sender, receiver, amount, memo);
      Tables().open<TokenHolderTable>().put(senderHolder);

      auto receiverHolder      = getTokenHolder(receiver);
      receiverHolder.eventHead = emit().history().transferred(receiverHolder.eventHead, tokenId,
                                                              time, sender, receiver, amount, memo);
      Tables().open<TokenHolderTable>().put(receiverHolder);
   }
}

void TokenSys::uncredit(TID                tokenId,
                        AccountNumber      receiver,
                        Quantity           maxAmount,
                        view<const String> memo)
{
   auto sender          = getSender();
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto creditorBalance = getBalance(tokenId, sender);
   auto uncreditAmt     = std::min(maxAmount.value, sharedBalance.balance);

   check(maxAmount.value > 0, quantityGt0);
   check(sharedBalance.balance > 0, insufficientBalance);

   sharedBalance.balance -= uncreditAmt;
   creditorBalance.balance += uncreditAmt;

   if (sharedBalance.balance == 0)
   {
      Tables().open<SharedBalanceTable>().erase(SharedBalanceKey{sender, receiver, tokenId});
   }
   else
   {
      Tables().open<SharedBalanceTable>().put(sharedBalance);
   }
   Tables().open<BalanceTable>().put(creditorBalance);
}

void TokenSys::debit(TID tokenId, AccountNumber sender, Quantity amount, view<const String> memo)
{
   auto receiver        = getSender();  //The action sender is the token receiver
   auto sharedBalance   = getSharedBal(tokenId, sender, receiver);
   auto receiverBalance = getBalance(tokenId, receiver);
   auto time            = to<TransactionSys>().currentBlock().time;

   check(amount.value > 0, quantityGt0);
   check(sharedBalance.balance >= amount.value, insufficientBalance);

   sharedBalance.balance -= amount.value;
   receiverBalance.balance += amount.value;

   if (sharedBalance.balance == 0)
   {
      Tables().open<SharedBalanceTable>().erase(SharedBalanceKey{sender, receiver, tokenId});
   }
   else
   {
      Tables().open<SharedBalanceTable>().put(sharedBalance);
   }
   Tables().open<BalanceTable>().put(receiverBalance);

   auto senderHolder      = getTokenHolder(sender);
   senderHolder.eventHead = emit().history().transferred(senderHolder.eventHead, tokenId, time,
                                                         sender, receiver, amount, memo);
   Tables().open<TokenHolderTable>().put(senderHolder);

   auto receiverHolder      = getTokenHolder(receiver);
   receiverHolder.eventHead = emit().history().transferred(receiverHolder.eventHead, tokenId, time,
                                                           sender, receiver, amount, memo);
   Tables().open<TokenHolderTable>().put(receiverHolder);
}

void TokenSys::recall(TID tokenId, AccountNumber from, Quantity amount, view<const String> memo)
{
   auto sender          = getSender();
   auto token           = getToken(tokenId);
   auto fromBalance     = getBalance(tokenId, from);
   auto unrecallableBit = TokenRecord::Configurations::value(tokenConfig::unrecallable);
   auto time            = to<TransactionSys>().currentBlock().time;

   check(isSenderIssuer(tokenId), missingRequiredAuth);
   check(not token.config.get(unrecallableBit), tokenUnrecallable);
   check(amount.value > 0, quantityGt0);
   check(fromBalance.balance >= amount.value, insufficientBalance);

   // Recall is ultimately a remote burn
   fromBalance.balance -= amount.value;

   auto balanceTable = Tables().open<BalanceTable>();
   balanceTable.put(fromBalance);

   auto holder = getTokenHolder(from);
   holder.eventHead =
       emit().history().recalled(holder.eventHead, tokenId, time, from, amount, memo);
   token.eventHead = emit().history().recalled(token.eventHead, tokenId, time, from, amount, memo);

   Tables().open<TokenHolderTable>().put(holder);
   Tables().open<TokenTable>().put(token);
}

void TokenSys::mapSymbol(TID tokenId, SID symbolId)
{
   auto sender     = getSender();
   auto symbol     = to<SymbolSys>().getSymbol(symbolId);
   auto token      = getToken(tokenId);
   auto nftService = to<NftSys>();

   check(symbol.ownerNft != NID{0}, symbolDNE);
   check(nftService.exists(symbol.ownerNft), missingRequiredAuth);
   check(token.symbolId == SID{0}, tokenHasSymbol);
   check(isSenderIssuer(tokenId), missingRequiredAuth);

   // Take ownership of the symbol owner NFT
   auto debitMemo = "Mapping symbol " + symbolId.str() + " to token " + std::to_string(tokenId);
   nftService.debit(symbol.ownerNft, debitMemo);

   // Emit mapped event
   token.eventHead = emit().history().symbolMapped(token.eventHead, tokenId, sender, symbolId);

   // Store mapping
   token.symbolId = symbolId;
   Tables().open<TokenTable>().put(token);

   // Destroy symbol owner NFT, it can never be used or traded again
   nftService.burn(symbol.ownerNft);
}

TokenRecord TokenSys::getToken(TID tokenId)
{
   auto tokenTable = Tables().open<TokenTable>();
   auto tokenOpt   = tokenTable.get(tokenId);
   psibase::check(tokenOpt.has_value(), tokenDNE);

   return *tokenOpt;
}

SID TokenSys::getTokenSymbol(TID tokenId)
{
   auto token = getToken(tokenId);
   psibase::check(token.symbolId != SID{0}, noMappedSymbol);

   return token.symbolId;
}

bool TokenSys::exists(TID tokenId)
{
   return Tables().open<TokenTable>().get(tokenId).has_value();
}

BalanceRecord TokenSys::getBalance(TID tokenId, AccountNumber account)
{
   auto balanceTable = Tables().open<BalanceTable>();
   auto balanceOpt   = balanceTable.get(BalanceKey{account, tokenId});

   BalanceRecord record;
   if (balanceOpt != std::nullopt)
   {
      record = *balanceOpt;
   }
   else
   {
      check(to<AccountSys>().exists(account), invalidAccount);
      check(exists(tokenId), tokenDNE);

      record = {.key = {account, tokenId}, .balance = 0};
   }

   return record;
}

SharedBalanceRecord TokenSys::getSharedBal(TID           tokenId,
                                           AccountNumber creditor,
                                           AccountNumber debitor)
{
   auto             sharedBalanceTable = Tables().open<SharedBalanceTable>();
   auto             sbIdx              = sharedBalanceTable.getIndex<0>();
   SharedBalanceKey key                = {creditor, debitor, tokenId};
   auto             sbOpt              = sbIdx.get(key);

   SharedBalanceRecord record;
   if (sbOpt != std::nullopt)
   {
      record = *sbOpt;
   }
   else
   {
      checkAccountValid(creditor);
      checkAccountValid(debitor);
      check(creditor != debitor, creditorIsDebitor);
      check(exists(tokenId), tokenDNE);

      record = {.key = key, .balance = 0};
   }

   return record;
}

TokenHolderRecord TokenSys::getTokenHolder(AccountNumber account)
{
   auto acTable = Tables().open<TokenHolderTable>();
   auto acIdx   = acTable.getIndex<0>();
   auto acOpt   = acIdx.get(account);

   TokenHolderRecord record;
   if (acOpt != std::nullopt)
   {
      record = *acOpt;
   }
   else
   {
      checkAccountValid(account);
      record = TokenHolderRecord{account};
   }

   return record;
}

bool TokenSys::getUserConf(psibase::AccountNumber account, psibase::EnumElement flag)
{
   auto holder = Tables().open<TokenHolderTable>().getIndex<0>().get(account);
   if (holder.has_value() == false)
   {
      return false;
   }
   else
   {
      return (*holder).config.get(TokenHolderConfig::value(flag));
   }
}

bool TokenSys::getTokenConf(TID tokenId, psibase::EnumElement flag)
{
   auto token     = getToken(tokenId);
   auto flagIndex = TokenRecord::Configurations::value(flag);

   return token.config.get(flagIndex);
}

void TokenSys::checkAccountValid(psibase::AccountNumber account)
{
   check(to<AccountSys>().exists(account), invalidAccount);
   check(account != AccountSys::nullAccount, invalidAccount);
}

bool TokenSys::isSenderIssuer(TID tokenId)
{
   auto token      = getToken(tokenId);
   auto nftService = to<NftSys>();

   return nftService.exists(token.ownerNft) &&
          nftService.getNft(token.ownerNft).owner == getSender();
}

PSIBASE_DISPATCH(UserService::TokenSys)
