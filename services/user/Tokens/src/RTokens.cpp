#include <cmath>
#include <psibase/dispatch.hpp>
#include <psibase/serveContent.hpp>
#include <psibase/serveGraphQL.hpp>
#include <psibase/serveSimpleUI.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/CommonApi.hpp>
#include <services/user/RTokens.hpp>
#include <services/user/Symbol.hpp>
#include <services/user/Tokens.hpp>
#include <string>
#include <vector>

using namespace UserService;
using namespace std;
using namespace psibase;
using SystemService::Accounts;
using SystemService::AccountTable;

auto tokenService = Tokens::Tables{Tokens::service};
namespace TokenQueryTypes
{
   struct Credit
   {
      SID           symbolId;
      TID           tokenId;
      Precision     precision;
      uint64_t      balance;
      AccountNumber creditedTo;
   };
   PSIO_REFLECT(Credit, symbolId, tokenId, precision, balance, creditedTo);

   struct Debit
   {
      SID           symbolId;
      TID           tokenId;
      Precision     precision;
      uint64_t      balance;
      AccountNumber debitableFrom;
   };
   PSIO_REFLECT(Debit, symbolId, tokenId, precision, balance, debitableFrom);

   struct TokenBalance
   {
      SID       symbolId;
      TID       tokenId;
      Precision precision;
      uint64_t  balance;
   };
   PSIO_REFLECT(TokenBalance, symbolId, tokenId, precision, balance);

   struct TokenOwnerDetails
   {
      AccountNumber account;
      AccountNumber authService;
   };
   PSIO_REFLECT(TokenOwnerDetails, account, authService);

   // Removed inflation details because the inflation params aren't yet supported
   //   in the service.
   struct TokenDetail
   {
      TID                              id;
      NID                              ownerNft;
      std::optional<TokenOwnerDetails> ownerDetails;
      psibase::Bitset<8>               config;
      Precision                        precision;
      SID                              symbolId;
      Quantity                         currentSupply;
      Quantity                         maxSupply;
   };
   PSIO_REFLECT(TokenDetail,
                id,
                ownerNft,
                ownerDetails,
                config,
                precision,
                symbolId,
                currentSupply,
                maxSupply);

}  // namespace TokenQueryTypes

/// A split key is used to specify a subindex on indices with a struct key.
///
/// Warning: No type checking! It's up to the user to ensure that T + Rest
///   is equivalent to the primary key)
template <typename Rest, typename T>
struct SplitKey
{
   T value;
};

template <typename Rest, typename T>
void to_key(const SplitKey<Rest, T>& obj, auto& stream)
{
   to_key(obj.value, stream);
}

template <typename Rest, typename T, typename S>
struct compatible_tuple_prefix<SplitKey<Rest, T>, S>
{
   static constexpr bool value = true;
};

template <typename Rest, typename T, typename S>
struct key_suffix_unqual<SplitKey<Rest, T>, S>
{
   using type = Rest;
};

using namespace TokenQueryTypes;
struct TokenQuery
{
   auto allBalances() const
   {  //
      return tokenService.open<BalanceTable>().getIndex<0>();
   }

   /// Provides a way to query all balances for a given user.
   /// Further filtering can be done to restrict the results by balance.
   auto userBalances(AccountNumber         user,
                     optional<uint32_t>    first,
                     optional<uint32_t>    last,
                     optional<std::string> before,
                     optional<std::string> after) const
   {
      vector<TokenBalance> balances;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      auto balanceIdx   = tokenService.open<BalanceTable>().getIndex<0>().subindex(
          SplitKey<TID, AccountNumber>{user});

      // Balances of this user
      for (auto balance : balanceIdx)
      {
         auto tokenOpt = tokenTypeIdx.get(balance.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         balances.push_back(TokenBalance{tokenOpt->symbolId, balance.key.tokenId,
                                         tokenOpt->precision, balance.balance});
      }

      return makeVirtualConnection<
          Connection<TokenBalance, "UserBalanceConnection", "UserBalanceEdge">, TokenBalance, SID>(
          balances, {std::nullopt}, {std::nullopt}, {std::nullopt}, {std::nullopt}, first, last,
          before, after);
   }

   auto userCredits(AccountNumber         user,
                    optional<uint32_t>    first,
                    optional<uint32_t>    last,
                    optional<std::string> before,
                    optional<std::string> after) const
   {
      vector<Credit> credits;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      auto creditIdx    = tokenService.open<SharedBalanceTable>().getIndex<0>().subindex(
          SplitKey<std::tuple<TID, AccountNumber>, AccountNumber>{user});

      for (auto credit : creditIdx)
      {
         auto tokenOpt = tokenTypeIdx.get(credit.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         credits.push_back(Credit{tokenOpt->symbolId, credit.key.tokenId, tokenOpt->precision,
                                  credit.balance, credit.key.debitor});
      }

      return makeVirtualConnection<Connection<Credit, "UserCreditConnection", "UserCreditEdge">,
                                   Credit, SID>(credits, {std::nullopt}, {std::nullopt},
                                                {std::nullopt}, {std::nullopt}, first, last, before,
                                                after);
   }

   auto userDebits(AccountNumber         user,
                   optional<uint32_t>    first,
                   optional<uint32_t>    last,
                   optional<std::string> before,
                   optional<std::string> after) const
   {
      vector<Debit> debits;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      auto debitIdx     = tokenService.open<SharedBalanceTable>().getIndex<1>().subindex(user);

      for (auto debit : debitIdx)
      {
         auto tokenOpt = tokenTypeIdx.get(debit.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         debits.push_back(Debit{tokenOpt->symbolId, debit.key.tokenId, tokenOpt->precision,
                                debit.balance, debit.key.creditor});
      }

      return makeVirtualConnection<Connection<Debit, "UserDebitConnection", "UserDebitEdge">, Debit,
                                   SID>(debits, {std::nullopt}, {std::nullopt}, {std::nullopt},
                                        {std::nullopt}, first, last, before, after);
   }

   auto userTokens(AccountNumber         user,
                   optional<uint32_t>    first,
                   optional<uint32_t>    last,
                   optional<std::string> before,
                   optional<std::string> after) const
   {
      std::vector<TokenRecord> tokens;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      for (auto token : tokenTypeIdx)
      {
         auto nft = Nft::Tables{Nft::service}.open<NftTable>().getIndex<0>().get(token.ownerNft);
         if (nft.has_value() && nft->owner == user)
         {
            tokens.push_back(token);
         }
      }

      return makeVirtualConnection<Connection<TokenRecord, "UserTokenConnection", "UserTokenEdge">,
                                   TokenRecord, TID>(tokens, {std::nullopt}, {std::nullopt},
                                                     {std::nullopt}, {std::nullopt}, first, last,
                                                     before, after);
   }

   auto tokens() const
   {  //
      return tokenService.open<TokenTable>().getIndex<0>();
   }

   auto tokenDetails(TID tokenId) const
   {
      auto token = tokenService.open<TokenTable>().getIndex<0>().get(tokenId);
      check(token.has_value(), "Token DNE");

      auto nft = Nft::Tables{Nft::service}.open<NftTable>().getIndex<0>().get(token->ownerNft);
      std::optional<TokenOwnerDetails> ownerDetails = std::nullopt;

      if (nft.has_value())
      {
         auto owner =
             Accounts::Tables{Accounts::service}.open<AccountTable>().getIndex<0>().get(nft->owner);
         check(owner.has_value(), "Account DNE. Should never happen.");

         ownerDetails = TokenOwnerDetails{
             .account     = nft->owner,
             .authService = owner->authService,
         };
      }

      // clang-format off
      return TokenDetail
      {
         .id            = token->id, 
         .ownerNft      = token->ownerNft,
         .ownerDetails  = ownerDetails,
         .config        = token->config,
         .precision     = token->precision,
         .symbolId      = token->symbolId,
         .currentSupply = token->currentSupply,
         .maxSupply     = token->maxSupply,
      };
      // clang-format on
   }

   auto userConf(AccountNumber user, psibase::EnumElement flag) const
   {
      auto holder = tokenService.open<TokenHolderTable>().getIndex<0>().get(user);
      check(holder.has_value(), "Token service has no record of user account");
      return holder->config.get(TokenHolderRecord::Configurations::value(flag));
   }
};

// clang-format off
PSIO_REFLECT(TokenQuery,
             method(allBalances),
             method(userBalances, user, first, last, before, after),
             method(userCredits, user, first, last, before, after),
             method(userDebits, user, first, last, before, after),
             method(userTokens, user, first, last, before, after),
             method(tokens),
             method(tokenDetails, tokenId),
             method(userConf, user, flag))
// clang-format on

optional<HttpReply> RTokens::serveSys(HttpRequest request)
{
   if (auto result = serveSimpleUI<Tokens, false>(request))
      return result;

   if (auto result = serveContent(request, ServiceTables<WebContentTable>{getReceiver()}))
      return result;

   if (auto result = serveGraphQL(request, TokenQuery{}))
      return result;

   return nullopt;
}

void RTokens::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(std::move(path), std::move(contentType), std::move(content),
                ServiceTables<WebContentTable>{getReceiver()});
}

PSIBASE_DISPATCH(UserService::RTokens)
