#pragma once
#include <catch2/catch.hpp>
#include <iostream>
#include <psibase/Actor.hpp>
#include <psibase/trace.hpp>

namespace psibase
{
   namespace internal_use_do_not_use
   {
      void hex(const uint8_t* begin, const uint8_t* end, std::ostream& os);

      template <typename R, typename C, typename... Args>
      R get_return_type(R (C::*f)(Args...));
      template <typename R, typename C, typename... Args>
      R get_return_type(R (C::*f)(Args...) const);
   }  // namespace internal_use_do_not_use

   namespace ContentTypes
   {
      const std::string html = "text/html";
      const std::string js   = "text/javascript";
   }  // namespace ContentTypes

   inline std::string show(bool include, TransactionTrace t)
   {
      if (include || t.error)
         std::cout << prettyTrace(trimRawData(t)) << "\n";
      if (t.error)
         return *t.error;
      return {};
   }

   inline const ActionTrace& get_top_action(TransactionTrace& t, size_t num)
   {
      // TODO: redesign TransactionTrace to make this easier
      // Current layout:
      //    verify proof 0
      //    verify proof 1
      //    ...
      //    transaction.sys (below is interspersed with events, console, etc. in execution order)
      //        check_auth
      //        action 0
      //        check_auth
      //        action 1
      //        ...
      check(!t.actionTraces.empty(), "TransactionTrace has no actions");
      auto&                           root = t.actionTraces.back();
      std::vector<const ActionTrace*> top_traces;
      for (auto& inner : root.innerTraces)
         if (std::holds_alternative<ActionTrace>(inner.inner))
            top_traces.push_back(&std::get<ActionTrace>(inner.inner));
      check(!(top_traces.size() & 1), "unexpected number of action traces");
      check(2 * num + 1 < top_traces.size(), "trace not found");
      return *top_traces[2 * num + 1];
   }

   std::vector<char> read_whole_file(std::string_view filename);

   int32_t execute(std::string_view command);

   /**
    * Validates the status of a transaction.  If expected_except is "", then the
    * transaction should succeed.  Otherwise it represents a string which should be
    * part of the error message.
    */
   void expect(TransactionTrace t, const std::string& expected = "", bool always_show = false);

   /**
    * Sign a digest
    */
   Signature sign(const PrivateKey& key, const Checksum256& digest);

   class TraceResult
   {
     public:
      TraceResult(TransactionTrace&& t);
      bool succeeded();
      bool failed(std::string_view expected);
      bool diskConsumed(const std::vector<std::pair<AccountNumber, int64_t>>& consumption);

      const TransactionTrace& trace() { return _t; }

     protected:
      TransactionTrace _t;
   };

   template <typename ReturnType>
   class Result : public TraceResult
   {
     public:
      Result(TransactionTrace&& t)
          : TraceResult(std::forward<TransactionTrace>(t)), _return(std::nullopt)
      {
         auto actionTrace = get_top_action(t, 0);
         if (actionTrace.rawRetval.size() != 0)
         {
            _return = psio::convert_from_frac<ReturnType>(actionTrace.rawRetval);
         }
      }

      ReturnType returnVal()
      {
         if (_return.has_value())
         {
            return (*_return);
         }
         else
         {
            show(true, _t);
            check(false, "Action aborted, no return value");
            return ReturnType();  // Silence compiler warning
         }
      }

     private:
      std::optional<ReturnType> _return;
   };

   template <>
   class Result<void> : public TraceResult
   {
     public:
      Result(TransactionTrace&& t) : TraceResult(std::forward<TransactionTrace>(t)) {}
   };

   /**
    * Manages a chain.
    * Only one test_chain can exist at a time.
    * The test chain uses simulated time starting at 2020-01-01T00:00:00.000.
    */
   class test_chain
   {
     private:
      uint32_t                 id;
      std::optional<BlockInfo> head_block_info;

     public:
      static const PublicKey  default_pub_key;
      static const PrivateKey default_priv_key;

      test_chain(const char* snapshot = nullptr, uint64_t state_size = 1024 * 1024 * 1024);
      test_chain(const test_chain&) = delete;
      virtual ~test_chain();

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

      void start_block(TimePointSec tp);

      /**
       * Finish the current pending block.  If no block is pending, creates an empty block.
       */
      void finish_block();

      const BlockInfo& get_head_block_info();

      /*
       * Set the reference block of the transaction to the head block.
       */
      void fill_tapos(Transaction& t, uint32_t expire_sec = 2);

      /*
       * Creates a transaction.
       */
      Transaction make_transaction(std::vector<Action>&& actions = {});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(const SignedTransaction& signed_trx);

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(
          const Transaction&                                   trx,
          const std::vector<std::pair<PublicKey, PrivateKey>>& keys = {
              {default_pub_key, default_priv_key}});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       *
       * Validates the transaction status according to @ref eosio::expect.
       */
      TransactionTrace transact(std::vector<Action>&&                                actions,
                                const std::vector<std::pair<PublicKey, PrivateKey>>& keys,
                                const char* expected_except = nullptr);
      TransactionTrace transact(std::vector<Action>&& actions,
                                const char*           expected_except = nullptr);

      template <typename Action, typename... Args>
      auto trace(const std::optional<std::vector<std::vector<char>>>& cfd,
                 const Action&                                        action,
                 Args&&... args)
      {
         if (!cfd)
         {
            return pushTransaction(
                make_transaction({action.to_action(std::forward<Args>(args)...)}),
                {default_priv_key});
         }
         else
         {
            return pushTransaction(
                make_transaction({}, {action.to_action(std::forward<Args>(args)...)}),
                {default_priv_key}, *cfd);
         }
      }

      template <typename Action>
      auto trace(Action&& a)
      {
         return pushTransaction(make_transaction({a}));
      }

      /**
       *  This will push a transaction and return the trace and return value
       */
      struct push_transaction_proxy
      {
         push_transaction_proxy(test_chain& t, AccountNumber s, AccountNumber r)
             : chain(t), sender(s), receiver(r)
         {
         }

         test_chain&   chain;
         AccountNumber sender;
         AccountNumber receiver;

         template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
         auto call(Args&&... args) const
         {
            using result_type = decltype(psio::result_of(MemberPtr));

            auto act = action_builder_proxy(sender, receiver)
                           .call<idx, Name, MemberPtr, Args...>(std::forward<Args>(args)...);

            return Result<result_type>(chain.trace(act));
         }
      };

      template <typename Contract>
      struct ContractUser : public psio::reflect<Contract>::template proxy<push_transaction_proxy>
      {
         using base = typename psio::reflect<Contract>::template proxy<push_transaction_proxy>;
         using base::base;

         auto* operator->() const { return this; }
         auto& operator*() const { return *this; }
      };

      struct UserContext
      {
         test_chain&   t;
         AccountNumber id;

         template <typename Other>
         auto at() const
         {
            return ContractUser<Other>(t, id, Other::contract);
         }

         operator AccountNumber() { return id; }
      };

      auto as(AccountNumber id) { return UserContext{*this, id}; }
   };  // test_chain

}  // namespace psibase
