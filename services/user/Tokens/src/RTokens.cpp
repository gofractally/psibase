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

auto tokenService = Tokens::Tables{Tokens::service};
namespace TokenQueryTypes
{
   auto realBalance = [](uint64_t bal, const Precision& p) -> uint64_t
   { return static_cast<uint64_t>(bal / pow(10, p.value)); };

   struct Credit
   {
      SID           symbolId;
      TID           tokenId;
      Precision     precision;
      uint64_t      balance;
      AccountNumber creditedTo;

      auto getKey() const { return realBalance(balance, precision); }
   };
   PSIO_REFLECT(Credit, symbolId, tokenId, precision, balance, creditedTo);

   struct Debit
   {
      SID           symbolId;
      TID           tokenId;
      Precision     precision;
      uint64_t      balance;
      AccountNumber debitableFrom;

      auto getKey() const { return realBalance(balance, precision); }
   };
   PSIO_REFLECT(Debit, symbolId, tokenId, precision, balance, debitableFrom);

   struct TokenBalance
   {
      SID       symbolId;
      TID       tokenId;
      Precision precision;
      uint64_t  balance;

      auto getKey() const { return realBalance(balance, precision); }
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
      TID                id;
      NID                ownerNft;
      TokenOwnerDetails  ownerDetails;
      psibase::Bitset<8> config;
      Precision          precision;
      SID                symbolId;
      Quantity           currentSupply;
      Quantity           maxSupply;
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
                     optional<uint64_t>    balance_gt,
                     optional<uint64_t>    balance_ge,
                     optional<uint64_t>    balance_lt,
                     optional<uint64_t>    balance_le,
                     optional<uint32_t>    first,
                     optional<uint32_t>    last,
                     optional<std::string> before,
                     optional<std::string> after) const
   {
      vector<TokenBalance> balances;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      auto balanceIdx   = tokenService.open<BalanceTable>().getIndex<1>().subindex(user);

      // Balances of this user
      for (auto balance : balanceIdx)
      {
         auto tokenOpt = tokenTypeIdx.get(balance.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         balances.push_back(TokenBalance{tokenOpt->symbolId, balance.key.tokenId,
                                         tokenOpt->precision, balance.balance});
      }

      return makeVirtualConnection<
          Connection<TokenBalance, "UserBalanceConnection", "UserBalanceEdge">>(
          balances, balance_gt, balance_ge, balance_lt, balance_le, first, last, before, after);
   }

   auto userCredits(AccountNumber         user,
                    optional<uint64_t>    balance_gt,
                    optional<uint64_t>    balance_ge,
                    optional<uint64_t>    balance_lt,
                    optional<uint64_t>    balance_le,
                    optional<uint32_t>    first,
                    optional<uint32_t>    last,
                    optional<std::string> before,
                    optional<std::string> after) const
   {
      vector<Credit> credits;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      auto creditIdx    = tokenService.open<SharedBalanceTable>().getIndex<1>();

      for (auto credit : creditIdx)
      {
         auto tokenOpt = tokenTypeIdx.get(credit.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         credits.push_back(Credit{tokenOpt->symbolId, credit.key.tokenId, tokenOpt->precision,
                                  credit.balance, credit.key.debitor});
      }

      return makeVirtualConnection<Connection<Credit, "UserCreditConnection", "UserCreditEdge">>(
          credits, balance_gt, balance_ge, balance_lt, balance_le, first, last, before, after);
   }

   auto userDebits(AccountNumber         user,
                   optional<uint64_t>    balance_gt,
                   optional<uint64_t>    balance_ge,
                   optional<uint64_t>    balance_lt,
                   optional<uint64_t>    balance_le,
                   optional<uint32_t>    first,
                   optional<uint32_t>    last,
                   optional<std::string> before,
                   optional<std::string> after) const
   {
      vector<Debit> debits;

      auto tokenTypeIdx = tokenService.open<TokenTable>().getIndex<0>();
      auto debitIdx     = tokenService.open<SharedBalanceTable>().getIndex<2>();

      for (auto debit : debitIdx)
      {
         auto tokenOpt = tokenTypeIdx.get(debit.key.tokenId);
         check(tokenOpt.has_value(), "Invalid token type");
         debits.push_back(Debit{tokenOpt->symbolId, debit.key.tokenId, tokenOpt->precision,
                                debit.balance, debit.key.creditor});
      }

      return makeVirtualConnection<Connection<Debit, "UserDebitConnection", "UserDebitEdge">>(
          debits, balance_gt, balance_ge, balance_lt, balance_le, first, last, before, after);
   }

   auto tokens() const
   {  //
      return tokenService.open<TokenTable>().getIndex<0>();
   }

   auto tokenDetails(TID tokenId) const
   {
      auto token = tokenService.open<TokenTable>().getIndex<0>().get(tokenId);
      check(token.has_value(), "Token DNE");

      auto nft   = to<Nft>().getNft(token->ownerNft);
      auto owner = SystemService::Accounts::Tables{SystemService::Accounts::service}
                       .open<SystemService::AccountTable>()
                       .getIndex<0>()
                       .get(nft.owner);
      check(owner.has_value(), "Account DNE. Should never happen.");

      // clang-format off
      return TokenDetail
      {
         .id = token->id, 
         .ownerNft = token->ownerNft,
         .ownerDetails = TokenOwnerDetails{
            .account     = nft.owner,
            .authService = owner->authService,
         },
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
      check(holder.has_value(), "Specified user does not hold any tokens");
      return holder->config.get(TokenHolderRecord::Configurations::value(flag));
   }
};

// clang-format off
PSIO_REFLECT(TokenQuery,
             method(allBalances),
             method(userBalances, user, balance_gt, balance_ge, balance_lt, balance_le, first, last, before, after),
             method(userCredits, user, balance_gt, balance_ge, balance_lt, balance_le, first, last, before, after),
             method(userDebits, user, balance_gt, balance_ge, balance_lt, balance_le, first, last, before, after),
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
