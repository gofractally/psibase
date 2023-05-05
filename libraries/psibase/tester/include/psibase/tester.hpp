#pragma once
#include <catch2/catch.hpp>
#include <iostream>
#include <psibase/Actor.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <psio/to_hex.hpp>

namespace psibase
{
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
            _return = psio::from_frac<ReturnType>(actionTrace.rawRetval);
         }
      }

      ReturnType returnVal()
      {
         if (_t.error.has_value())
         {
            std::cout << prettyTrace(trimRawData(_t)).c_str();
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

   using KeyList = std::vector<std::pair<psibase::PublicKey, psibase::PrivateKey>>;

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
      bool                              producing        = false;
      bool                              isAutoBlockStart = true;

     public:
      static const PublicKey  defaultPubKey;
      static const PrivateKey defaultPrivKey;

      static KeyList defaultKeys() { return {{defaultPubKey, defaultPrivKey}}; }

      TestChain(uint64_t hot_bytes  = 1ull << 27,
                uint64_t warm_bytes = 1ull << 27,
                uint64_t cool_bytes = 1ull << 27,
                uint64_t cold_bytes = 1ull << 27);
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
       * By default, the TestChain will automatically advance blocks.
       * When autoBlockStart is disabled, the the chain will only advance blocks manually.
       * To manually advance a block, you must call startBlock.
       *
       * @param enable Whether the chain should automatically advance blocks.
       */
      void setAutoBlockStart(bool enable);

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
      void fillTapos(Transaction& t, uint32_t expire_sec = 2) const;

      /*
       * Creates a transaction.
       */
      Transaction makeTransaction(std::vector<Action>&& actions = {}) const;

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(const SignedTransaction& signedTrx);

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(Transaction    trx,
                                                     const KeyList& keys = defaultKeys());

      template <typename Action>
      auto trace(Action&& a, const KeyList& keyList = defaultKeys())
      {
         return pushTransaction(makeTransaction({a}), keyList);
      }

      /**
       *  This will push a transaction and return the trace and return value
       */
      struct PushTransactionProxy
      {
         PushTransactionProxy(TestChain& t, AccountNumber s, AccountNumber r, const KeyList& keys)
             : chain(t), sender(s), receiver(r), keys(keys)
         {
         }

         TestChain&    chain;
         AccountNumber sender;
         AccountNumber receiver;
         KeyList       keys;

         template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
         auto call(Args&&... args) const
         {
            using result_type = decltype(psio::result_of(MemberPtr));

            auto act = action_builder_proxy(sender, receiver)
                           .call<idx, Name, MemberPtr, Args...>(std::forward<Args>(args)...);

            if (chain.isAutoBlockStart)
            {
               chain.startBlock(0);
            }

            return Result<result_type>(chain.trace(act, keys));
         }
      };

      template <typename Service>
      struct ServiceUser : public psio::reflect<Service>::template proxy<PushTransactionProxy>
      {
         using base = typename psio::reflect<Service>::template proxy<PushTransactionProxy>;
         using base::base;
      };

      struct UserContext
      {
         TestChain&    t;
         AccountNumber id;
         KeyList       signingKeys;

         template <typename Other>
         auto to() const
         {
            return ServiceUser<Other>(t, id, Other::service, signingKeys);
         }

         auto with(const KeyList& signingKeys)
         {  //
            return UserContext{t, id, signingKeys};
         }

         operator AccountNumber() { return id; }
      };

      auto from(AccountNumber id) { return UserContext{*this, id, defaultKeys()}; }
   };  // TestChain

}  // namespace psibase

template <>
struct Catch::StringMaker<psibase::Checksum256>
{
   static std::string convert(const psibase::Checksum256& obj)
   {
      return psio::hex(obj.begin(), obj.end());
   }
};
