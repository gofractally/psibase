#pragma once
#include <catch2/catch.hpp>
#include <iostream>
#include <psibase/Actor.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <psio/to_hex.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>

#include <fcntl.h>

namespace psibase
{
   using KeyList = std::vector<std::pair<SystemService::AuthSig::SubjectPublicKeyInfo,
                                         SystemService::AuthSig::PrivateKeyInfo>>;

   inline std::string show(bool include, TransactionTrace t)
   {
      if (include || t.error)
         std::cout << prettyTrace(trimRawData(t)) << "\n";
      if (t.error)
         return *t.error;
      return {};
   }

   inline bool isUserAction(const Action& action)
   {
      if (action.service == AccountNumber{"cpu-limit"})
         return false;
      if (action.service == AccountNumber{"accounts"} && action.method == MethodNumber{"billCpu"})
         return false;
      if (action.service == AccountNumber{"events"} && action.method == MethodNumber{"sync"})
         return false;
      return true;
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
         if (auto at = std::get_if<ActionTrace>(&inner.inner))
            if (isUserAction(at->action))
               top_traces.push_back(at);
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

   struct DatabaseConfig
   {
      std::uint64_t hotBytes  = 1ull << 27;
      std::uint64_t warmBytes = 1ull << 27;
      std::uint64_t coolBytes = 1ull << 27;
      std::uint64_t coldBytes = 1ull << 27;
   };

   template <typename T>
   concept HttpRequestBody = requires(const T& t) {
      { t.contentType() } -> std::convertible_to<std::string>;
      { t.body() } -> std::convertible_to<std::vector<char>>;
   };

   /**
    * Manages a chain.
    * The test chain uses simulated time.
    */
   class TestChain
   {
     private:
      uint32_t                          id;
      std::optional<psibase::StatusRow> status;
      bool                              producing        = false;
      bool                              isAutoBlockStart = true;
      bool                              isPublicChain;

      explicit TestChain(uint32_t chain_id, bool clone, bool pub = true);

     public:
      // Clones the chain
      TestChain(const TestChain&, bool pub);
      /**
       * Creates a new temporary chain.
       *
       * @param pub If this is the only public chain, it will be automatically
       * selected.
       */
      explicit TestChain(const DatabaseConfig&, bool pub = true);
      /**
       * Opens a chain.
       *
       * @param flags must include at least either O_RDONLY or O_RDWR, and
       * can also contain O_CREAT, O_EXCL, and O_TRUNC.
       */
      TestChain(std::string_view      path,
                int                   flags = O_CREAT | O_RDWR,
                const DatabaseConfig& cfg   = {},
                bool                  pub   = true);
      TestChain(uint64_t hot_bytes  = 1ull << 27,
                uint64_t warm_bytes = 1ull << 27,
                uint64_t cool_bytes = 1ull << 27,
                uint64_t cold_bytes = 1ull << 27);
      virtual ~TestChain();

      TestChain& operator=(const TestChain&) = delete;

      /**
       * Boots the chain.
       */
      void boot(const std::vector<std::string>& names, bool installUI);

      /**
       * Shuts down the chain to allow copying its state file. The chain's temporary path will
       * live until this object destructs.
       */
      void shutdown();

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
       * @param skip_milliseconds The amount of time to skip in addition to the 1s block time.
       * truncated to a multiple of 1s.
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
      Transaction makeTransaction(std::vector<Action>&& actions    = {},
                                  uint32_t              expire_sec = 2) const;

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(const SignedTransaction& signedTrx);

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(Transaction trx, const KeyList& keys = {});

      /**
       * Creates a POST request with a JSON body
       */
      template <typename T>
      HttpRequest makePost(AccountNumber account, std::string_view target, const T& data) const
      {
         HttpRequest         req{.host     = account.str() + ".psibase.io",
                                 .rootHost = "psibase.io",
                                 .method   = "POST",
                                 .target{target},
                                 .contentType = "application/json"};
         psio::vector_stream stream{req.body};
         using psio::to_json;
         to_json(data, stream);
         return req;
      }

      /**
       * Creates a POST request
       */
      template <HttpRequestBody T>
      HttpRequest makePost(AccountNumber account, std::string_view target, const T& data) const
      {
         return {.host     = account.str() + ".psibase.io",
                 .rootHost = "psibase.io",
                 .method   = "POST",
                 .target{target},
                 .contentType = data.contentType(),
                 .body        = data.body()};
      }

      /**
       * Creates a GET request
       */
      HttpRequest makeGet(AccountNumber account, std::string_view target) const
      {
         return {.host     = account.str() + ".psibase.io",
                 .rootHost = "psibase.io",
                 .method   = "POST",
                 .target{target}};
      }

      /**
       * Runs a query and returns the response
       */
      HttpReply http(const HttpRequest& request);
      /**
       * Runs a query and deserializes the body of the response
       */
      template <typename R>
      R http(const HttpRequest& request)
      {
         auto response = http(request);
         if constexpr (std::is_convertible_v<HttpReply, R>)
         {
            return response;
         }
         else
         {
            if (response.status != HttpStatus::ok)
            {
               if (response.contentType == "text/html")
               {
                  abortMessage(std::to_string(static_cast<std::uint16_t>(response.status)) + " " +
                               std::string(response.body.begin(), response.body.end()));
               }
               else
               {
                  abortMessage("Request returned " +
                               std::to_string(static_cast<std::uint16_t>(response.status)));
               }
            }
            if (response.contentType != "application/json")
               abortMessage("Wrong Content-Type " + response.contentType);
            response.body.push_back('\0');
            psio::json_token_stream stream(response.body.data());
            return psio::from_json<R>(stream);
         }
      }

      template <typename R = HttpReply, typename T>
      R post(AccountNumber account, std::string_view target, const T& data)
      {
         return http<R>(makePost(account, target, data));
      }

      template <typename R = HttpReply>
      R get(AccountNumber account, std::string_view target)
      {
         return http<R>(makeGet(account, target));
      }

      template <typename Action>
      auto trace(Action&& a, const KeyList& keyList = {})
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

         template <uint32_t idx, auto MemberPtr, typename... Args>
         auto call(Args&&... args) const
         {
            using result_type = decltype(psio::result_of(MemberPtr));

            auto act = action_builder_proxy(sender, receiver)
                           .call<idx, MemberPtr, Args...>(std::forward<Args>(args)...);

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

      auto from(AccountNumber id) { return UserContext{*this, id, {}}; }

      std::uint32_t nativeHandle() const { return id; }

      /// Get a key-value pair, if any
      std::optional<std::vector<char>> kvGetRaw(psibase::DbId db, psio::input_stream key);

      /// Get a key-value pair, if any
      template <typename V, typename K>
      std::optional<V> kvGet(psibase::DbId db, const K& key)
      {
         auto v = kvGetRaw(db, psio::convert_to_key(key));
         if (!v)
            return std::nullopt;
         // TODO: validate (allow opt-in or opt-out)
         return psio::from_frac<V>(psio::prevalidated{*v});
      }

      /// Get a key-value pair, if any
      template <typename V, typename K>
      std::optional<V> kvGet(const K& key)
      {
         return kvGet<V>(psibase::DbId::service, key);
      }
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
