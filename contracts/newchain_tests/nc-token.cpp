#include "nc-token.hpp"

using namespace newchain;

static constexpr bool enable_print = false;

namespace token
{
   eosio::asset get_balance(account_num this_contract, account_num acc, eosio::symbol sym)
   {
      auto result = kv_get<eosio::asset>(std::tuple{this_contract, acc, sym.code()});
      if (!result)
         return {0, sym};
      check(result->symbol == sym, "symbol precision mismatch");
      return *result;
   }

   void set_balance(account_num this_contract, account_num acc, eosio::asset amount)
   {
      kv_set(std::tuple{this_contract, acc, amount.symbol.code()}, amount);
   }

   // TODO: This does a blind issue; need to track created tokens and limits
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

   extern "C" void called(account_num this_contract, account_num sender)
   {
      auto act  = get_current_action();
      auto data = eosio::convert_from_bin<action>(act.raw_data);
      std::visit(
          [&](auto& x) {
             if constexpr (std::is_same_v<decltype(exec(this_contract, sender, x)), void>)
                exec(this_contract, sender, x);
             else
                set_retval(exec(this_contract, sender, x));
          },
          data);
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace token
