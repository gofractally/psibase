#pragma once

#include <eosio/asset.hpp>
#include <iostream>
#include <newchain/trace.hpp>

namespace newchain
{
   namespace internal_use_do_not_use
   {
      void hex(const uint8_t* begin, const uint8_t* end, std::ostream& os);

      template <typename R, typename C, typename... Args>
      R get_return_type(R (C::*f)(Args...));
      template <typename R, typename C, typename... Args>
      R get_return_type(R (C::*f)(Args...) const);
   }  // namespace internal_use_do_not_use

   std::vector<char> read_whole_file(std::string_view filename);

   int32_t execute(std::string_view command);

   eosio::asset string_to_asset(const char* s);

   inline eosio::asset s2a(const char* s) { return string_to_asset(s); }

   /**
    * Validates the status of a transaction.  If expected_except is nullptr, then the
    * transaction should succeed.  Otherwise it represents a string which should be
    * part of the error message.
    */
   void expect(const transaction_trace& tt, const char* expected_except = nullptr);

   /**
    * Sign a digest.  This is here and not in crypto.hpp, because it is
    * only available in the tester.
    */
   eosio::signature sign(const eosio::private_key& key, const eosio::checksum256& digest);

   /**
    * Manages a chain.
    * Only one test_chain can exist at a time.
    * The test chain uses simulated time starting at 2020-01-01T00:00:00.000.
    */
   class test_chain
   {
     private:
      uint32_t                  id;
      std::optional<block_info> head_block_info;

     public:
      static const eosio::public_key  default_pub_key;
      static const eosio::private_key default_priv_key;

      test_chain(const char* snapshot = nullptr, uint64_t state_size = 1024 * 1024 * 1024);
      test_chain(const test_chain&) = delete;
      ~test_chain();

      test_chain& operator=(const test_chain&) = delete;

      /**
       * Shuts down the chain to allow copying its state file. The chain's temporary path will
       * live until this object destructs.
       */
      void shutdown();

      /**
       * Get the temporary path which contains the chain's blocks and states directories
       */
      std::string get_path();

      /**
       * Start a new pending block.  If a block is currently pending, finishes it first.
       * May push additional blocks if any time is skipped.
       *
       * @param skip_milliseconds The amount of time to skip in addition to the 500 ms block time.
       * truncated to a multiple of 500 ms.
       */
      void start_block(int64_t skip_miliseconds = 0);

      void start_block(std::string_view time);

      void start_block(eosio::time_point tp);

      /**
       * Finish the current pending block.  If no block is pending, creates an empty block.
       */
      void finish_block();

      const block_info& get_head_block_info();

      /*
       * Set the reference block of the transaction to the head block.
       */
      void fill_tapos(transaction& t, uint32_t expire_sec = 2);

      /*
       * Creates a transaction.
       */
      transaction make_transaction(std::vector<action>&& actions  = {},
                                   std::vector<action>&& cfaction = {});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] transaction_trace push_transaction(
          const transaction&                     trx,
          const std::vector<eosio::private_key>& keys       = {default_priv_key},
          const std::vector<eosio::signature>&   signatures = {});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       *
       * Validates the transaction status according to @ref eosio::expect.
       */
      transaction_trace transact(std::vector<action>&&                  actions,
                                 const std::vector<eosio::private_key>& keys,
                                 const char*                            expected_except = nullptr);
      transaction_trace transact(std::vector<action>&& actions,
                                 const char*           expected_except = nullptr);

      /**
       * Pushes a transaction with action onto the chain and converts its return value.
       * If no block is currently pending, starts one.
       */
      template <typename Action, typename... Args>
      auto action_with_return(const Action& action, Args&&... args)
      {
         using Ret  = decltype(internal_use_do_not_use::get_return_type(Action::get_mem_ptr()));
         auto trace = transact({action.to_action(std::forward<Args>(args)...)});
         return convert_from_bin<Ret>(trace.action_traces[0].return_value);
      }

      template <typename Action, typename... Args>
      auto act(const std::optional<std::vector<std::vector<char>>>& cfd,
               const Action&                                        action,
               Args&&... args)
      {
         using Ret  = decltype(internal_use_do_not_use::get_return_type(Action::get_mem_ptr()));
         auto trace = this->trace(cfd, action, std::forward<Args>(args)...);
         expect(trace);
         if constexpr (!std::is_same_v<Ret, void>)
         {
            return convert_from_bin<Ret>(trace.action_traces[0].return_value);
         }
         else
         {
            return trace;
         }
      }

      template <typename Action, typename... Args>
      auto trace(const std::optional<std::vector<std::vector<char>>>& cfd,
                 const Action&                                        action,
                 Args&&... args)
      {
         if (!cfd)
         {
            return push_transaction(
                make_transaction({action.to_action(std::forward<Args>(args)...)}),
                {default_priv_key});
         }
         else
         {
            return push_transaction(
                make_transaction({}, {action.to_action(std::forward<Args>(args)...)}),
                {default_priv_key}, *cfd);
         }
      }

      struct user_context
      {
         test_chain&                t;
         account_num                sender;
         std::optional<account_num> contract;

         user_context with_code(account_num contract)
         {
            user_context uc = *this;
            uc.contract     = contract;
            return uc;
         }

         template <typename Action, typename... Args>
         auto act(Args&&... args)
         {
            if (contract)
               return t.act(Action(*contract, sender), std::forward<Args>(args)...);
            else
               return t.act(Action(sender), std::forward<Args>(args)...);
         }

         template <typename Action, typename... Args>
         auto trace(Args&&... args)
         {
            if (contract)
               return t.trace(Action(*contract, sender), std::forward<Args>(args)...);
            else
               return t.trace(Action(sender), std::forward<Args>(args)...);
         }
      };

      auto as(account_num sender) { return user_context{*this, sender}; }
   };  // test_chain
}  // namespace newchain

namespace eosio
{
   template <std::size_t Size>
   std::ostream& operator<<(std::ostream& os, const fixed_bytes<Size>& d)
   {
      auto arr = d.extract_as_byte_array();
      newchain::internal_use_do_not_use::hex(arr.begin(), arr.end(), os);
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const time_point_sec& obj);
   std::ostream& operator<<(std::ostream& os, const name& obj);
   std::ostream& operator<<(std::ostream& os, const asset& obj);
}  // namespace eosio
