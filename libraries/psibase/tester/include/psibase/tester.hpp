#pragma once
#include <catch2/catch.hpp>
#include <iostream>
#include <psibase/Actor.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/print.hpp>
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

   inline std::string show(bool include, TransactionTrace t)
   {
      if (include || t.error)
         std::cout << prettyTrace(trimRawData(t)) << "\n";
      if (t.error)
         return *t.error;
      return {};
   }

   inline const ActionTrace& getTopAction(TransactionTrace& t, size_t num)
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

   std::vector<char> readWholeFile(std::string_view filename);

   int32_t execute(std::string_view command);

   /**
    * Validates the status of a transaction.  If expectedExcept is "", then the
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
      //bool diskConsumed(const std::vector<std::pair<AccountNumber, int64_t>>& consumption);

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
         auto actionTrace = getTopAction(t, 0);
         if (actionTrace.rawRetval.size() != 0)
         {
            _return = psio::convert_from_frac<ReturnType>(actionTrace.rawRetval);
         }
      }

      ReturnType returnVal()
      {
         if (_t.error.has_value())
         {
            psibase::print(prettyTrace(trimRawData(_t)).c_str());
         }

         if (_return.has_value())
         {
            return (*_return);
         }
         else
         {
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
    * Only one TestChain can exist at a time.
    * The test chain uses simulated time.
    */
   class TestChain
   {
     private:
      uint32_t                          id;
      std::optional<psibase::StatusRow> status;
      bool                              producing = false;

     public:
      static const PublicKey  defaultPubKey;
      static const PrivateKey defaultPrivKey;

      TestChain(uint64_t max_objects    = 1'000'000,
                uint64_t hot_addr_bits  = 27,
                uint64_t warm_addr_bits = 27,
                uint64_t cool_addr_bits = 27,
                uint64_t cold_addr_bits = 27);
      TestChain(const TestChain&) = delete;
      virtual ~TestChain();

      TestChain& operator=(const TestChain&) = delete;

      /**
       * Shuts down the chain to allow copying its state file. The chain's temporary path will
       * live until this object destructs.
       */
      void shutdown();

      /**
       * Get the temporary path which contains the chain's blocks and states directories
       */
      std::string getPath();

      /**
       * Start a new pending block.  If a block is currently pending, finishes it first.
       * May push additional blocks if any time is skipped.
       *
       * @param skip_milliseconds The amount of time to skip in addition to the 500 ms block time.
       * truncated to a multiple of 500 ms.
       */
      void startBlock(int64_t skip_miliseconds = 0);

      void startBlock(std::string_view time);

      void startBlock(TimePointSec tp);

      /**
       * Finish the current pending block.  If no block is pending, creates an empty block.
       */
      void finishBlock();

      /*
       * Set the reference block of the transaction to the head block.
       */
      void fillTapos(Transaction& t, uint32_t expire_sec = 2);

      /*
       * Creates a transaction.
       */
      Transaction makeTransaction(std::vector<Action>&& actions = {});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(const SignedTransaction& signedTrx);

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(
          Transaction                                          trx,
          const std::vector<std::pair<PublicKey, PrivateKey>>& keys = {
              {defaultPubKey, defaultPrivKey}});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       *
       * Validates the transaction status according to @ref eosio::expect.
       */
      TransactionTrace transact(std::vector<Action>&&                                actions,
                                const std::vector<std::pair<PublicKey, PrivateKey>>& keys,
                                const char* expectedExcept = nullptr);
      TransactionTrace transact(std::vector<Action>&& actions,
                                const char*           expectedExcept = nullptr);

      template <typename Action, typename... Args>
      auto trace(const std::optional<std::vector<std::vector<char>>>& cfd,
                 const Action&                                        action,
                 Args&&... args)
      {
         if (!cfd)
         {
            return pushTransaction(makeTransaction({action.to_action(std::forward<Args>(args)...)}),
                                   {defaultPrivKey});
         }
         else
         {
            return pushTransaction(
                makeTransaction({}, {action.to_action(std::forward<Args>(args)...)}),
                {defaultPrivKey}, *cfd);
         }
      }

      template <typename Action>
      auto trace(Action&& a)
      {
         return pushTransaction(makeTransaction({a}));
      }

      /**
       *  This will push a transaction and return the trace and return value
       */
      struct PushTransactionProxy
      {
         PushTransactionProxy(TestChain& t, AccountNumber s, AccountNumber r)
             : chain(t), sender(s), receiver(r)
         {
         }

         TestChain&    chain;
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

      template <typename Service>
      struct ServiceUser : public psio::reflect<Service>::template proxy<PushTransactionProxy>
      {
         using base = typename psio::reflect<Service>::template proxy<PushTransactionProxy>;
         using base::base;

         auto* operator->() const { return this; }
         auto& operator*() const { return *this; }
      };

      struct UserContext
      {
         TestChain&    t;
         AccountNumber id;

         template <typename Other>
         auto to() const
         {
            return ServiceUser<Other>(t, id, Other::service);
         }

         operator AccountNumber() { return id; }
      };

      auto from(AccountNumber id) { return UserContext{*this, id}; }
   };  // TestChain

}  // namespace psibase
