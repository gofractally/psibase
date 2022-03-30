#include "token.hpp"
#include <psibase/dispatch.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace token
{

   uint64_t token::getBalance( AccountNumber owner )
   {
      auto result = kv_get<uint64_t>(std::tuple{token::contract, owner});
      if (!result)
         return 0;
   //   check(result->symbol == sym, "symbol precision mismatch");
      return *result;
   }

   void set_balance(account_num acc, uint64_t amount)
   {
      kv_put(std::tuple{token::contract, acc}, amount);
   }

   uint8_t token::transfer( AccountNumber to, uint64_t amount, const_view<String> memo ) {
      auto fb = getBalance( get_sender() );
      check( fb >= amount, "insufficient funds" );

      set_balance( get_sender(), fb - amount );

      auto tb = getBalance( to );
      set_balance( to, tb + amount );
      return 0;
   }

   uint8_t token::issue( AccountNumber to, uint64_t amount, const_view<String> memo ) {
      check(get_sender() == token::contract, "sender must be token account");
      set_balance( to, amount );
      return 0;
   }

   /*
   void exec(account_num this_contract, account_num sender, issue& args)
   {
      check(sender == token::contract, "sender must be token account");
      if (enable_print)
         printf("issue %s to %d\n", args.amount.to_string().c_str(), args.to);
      set_balance(this_contract, args.to,
                  get_balance(this_contract, args.to, args.amount.symbol) + args.amount);
      if (enable_print)
         printf(" new balance: %s\n",
                get_balance(this_contract, args.to, args.amount.symbol).to_string().c_str());
   }

   void exec(account_num this_contract, account_num sender, transfer& args)
   {
      auto from_bal = get_balance(this_contract, sender, args.amount.symbol);
      if (enable_print)
         printf("transfer %d->%d %s", sender, args.to, args.amount.to_string().c_str());
      check(args.amount.amount > 0, "may only transfer positive amount");
      check(args.amount.amount <= from_bal.amount, "do not have enough funds");
      set_balance(this_contract, sender, from_bal - args.amount);
      set_balance(this_contract, args.to,
                  get_balance(this_contract, args.to, args.amount.symbol) + args.amount);
      if (enable_print)
         printf(" new balances: %s %s\n",
                get_balance(this_contract, sender, args.amount.symbol).to_string().c_str(),
                get_balance(this_contract, args.to, args.amount.symbol).to_string().c_str());
   }
   */

}  // namespace token

PSIBASE_DISPATCH( token::token )
