#pragma once
#include <catch2/catch_tostring.hpp>
#include <iostream>
#include <psibase/Actor.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/fileUtil.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <psio/to_hex.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/VirtualServer.hpp>
#include "services/system/Transact.hpp"

#include <fcntl.h>

namespace psibase
{
   using KeyPair = std::pair<SystemService::AuthSig::SubjectPublicKeyInfo,
                             SystemService::AuthSig::PrivateKeyInfo>;
   using KeyList = std::vector<KeyPair>;

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
      if (action.service == "db"_a && action.method == "open"_m)
         return false;
      if (action.service == "cpu-limit"_a)
         return false;
      if (action.sender == SystemService::Transact::service &&
          action.service == SystemService::VirtualServer::service)
         return false;
      if (action.service == "events"_a && action.method == "sync"_m)
         return false;
      if (action.sender == AccountNumber{})
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
      if (top_traces.size() & 1)
      {
         for (const ActionTrace* trace : top_traces)
         {
            std::cout << trace->action.service.str() << "::" << trace->action.method.str() << "\n";
         }
      }
      check(!(top_traces.size() & 1), "unexpected number of action traces");
      check(2 * num + 1 < top_traces.size(), "trace not found");
      return *top_traces[2 * num + 1];
   }

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
         if (!_t.error.has_value())
         {
            auto actionTrace = getTopAction(t, 0);
            if (actionTrace.rawRetval.size() != 0)
            {
               _return = psio::from_frac<ReturnType>(actionTrace.rawRetval);
            }
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

   template <typename T>
   concept HttpReplyBody = requires(std::vector<char>&& t) {
      { T::contentType() } -> std::convertible_to<std::string>;
      { T::unpack(std::move(t)) };
   };

   struct GraphQLBody
   {
      std::string       contentType() const { return "application/graphql"; }
      std::vector<char> body() const { return {text.begin(), text.end()}; }
      std::string_view  text;
   };

   template <typename T>
   struct FracPackBody
   {
      std::string       contentType() const { return "application/octet-stream"; }
      std::vector<char> body() const { return psio::to_frac(value); }
      T                 value;
   };

   template <typename T>
   struct JsonBody
   {
      static std::string contentType() { return "application/json"; }
      std::vector<char>  body() const
      {
         std::vector<char>   result;
         psio::vector_stream stream{result};
         to_json(value, stream);
         return result;
      }
      static JsonBody unpack(std::vector<char> data)
      {
         data.push_back('\0');
         psio::json_token_stream stream(data.data());
         return {psio::from_json<T>(stream)};
      }
      T value;
   };

   struct EmptyBody
   {
      std::string       contentType() const { return {}; }
      std::vector<char> body() const { return {}; }
   };

   template <typename R>
   R unpackReply(HttpReply&& response)
   {
      if constexpr (std::is_convertible_v<HttpReply, R>)
      {
         return std::move(response);
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
         if constexpr (HttpReplyBody<R>)
         {
            if (response.contentType != R::contentType())
               abortMessage("Wrong Content-Type " + response.contentType);
            return R::unpack(std::move(response.body));
         }
         else
         {
            if (response.contentType == "application/json")
               return JsonBody<R>::unpack(std::move(response.body)).value;
            else
               abortMessage("Wrong Content-Type " + response.contentType);
         }
      }
   }

   struct AsyncHttpReply
   {
      std::int32_t             fd;
      std::optional<HttpReply> poll();
      template <typename R>
      std::optional<R> poll()
      {
         if (auto reply = poll())
         {
            return unpackReply<R>(std::move(*reply));
         }
         else
         {
            return {};
         }
      }
      template <typename R = HttpReply>
      R get()
      {
         auto reply = poll();
         if (!reply)
            abortMessage("HTTP response not available");
         return unpackReply<R>(std::move(*reply));
      }
   };

   class HttpRequestBuilder
   {
     public:
      HttpRequestBuilder(AccountNumber account = {}, std::vector<HttpHeader> headers = {})
          : _account(account), _headers(headers)
      {
      }
      template <typename Self>
      Self&& header(this Self&& self, HttpHeader header)
      {
         self._headers.push_back(std::move(header));
         return std::forward<Self>(self);
      }
      template <typename Self>
      Self&& header(this Self&& self, std::string_view name, std::string_view value)
      {
         self._headers.push_back({std::string{name}, std::string{value}});
         return std::forward<Self>(self);
      }
      template <typename Self>
      Self&& token(this Self&& self, std::string_view token)
      {
         self._headers.push_back({"Authorization", std::format("Bearer {}", token)});
         return std::forward<Self>(self);
      }
      template <typename Self>
      Self&& account(this Self&& self, AccountNumber account)
      {
         self._account = account;
      }

      struct Default
      {
      };

      template <typename R = Default, typename Self>
      decltype(auto) get(this Self&& self, std::string target, std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(AccountNumber{}, "GET", target,
                                                             EmptyBody{}, std::move(headers));
      }
      template <typename R = Default, typename Self>
      decltype(auto) get(this Self&&             self,
                         AccountNumber           account,
                         std::string             target,
                         std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(account, "GET", target, EmptyBody{},
                                                             std::move(headers));
      }
      template <typename R = Default, typename Self, HttpRequestBody T>
      decltype(auto) post(this Self&&             self,
                          AccountNumber           account,
                          std::string             target,
                          const T&                body,
                          std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(account, "POST", target, body,
                                                             std::move(headers));
      }
      template <typename R = Default, typename Self, HttpRequestBody T>
      decltype(auto) post(this Self&&             self,
                          std::string             target,
                          const T&                body,
                          std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(AccountNumber{}, "POST", target, body,
                                                             std::move(headers));
      }
      template <typename R = Default, typename Self, HttpRequestBody T>
      decltype(auto) put(this Self&&             self,
                         AccountNumber           account,
                         std::string             target,
                         const T&                body,
                         std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(account, "PUT", target, body,
                                                             std::move(headers));
      }
      template <typename R = Default, typename Self, HttpRequestBody T>
      decltype(auto) put(this Self&&             self,
                         std::string             target,
                         const T&                body,
                         std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(AccountNumber{}, "PUT", target, body,
                                                             std::move(headers));
      }

      template <typename R = Default, typename Self>
      decltype(auto) request(this Self&&             self,
                             std::string_view        method,
                             std::string_view        target,
                             std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(AccountNumber{}, method, target,
                                                             EmptyBody{}, std::move(headers));
      }

      template <typename R = Default, typename Self>
      decltype(auto) request(this Self&&             self,
                             AccountNumber           account,
                             std::string_view        method,
                             std::string_view        target,
                             std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(account, method, target, EmptyBody{},
                                                             std::move(headers));
      }

      template <typename R = Default, typename Self, HttpRequestBody T>
      decltype(auto) request(this Self&&             self,
                             std::string_view        method,
                             std::string_view        target,
                             const T&                body,
                             std::vector<HttpHeader> headers = {})
      {
         return std::forward<Self>(self).template request<R>(AccountNumber{}, method, target, body,
                                                             std::move(headers));
      }

      template <typename R = Default, HttpRequestBody T>
      auto request(AccountNumber           account,
                   std::string_view        method,
                   std::string_view        target,
                   const T&                body,
                   std::vector<HttpHeader> headers = {})
      {
         return HttpRequest{.host = buildHost(account),
                            .method{method},
                            .target{target},
                            .contentType = body.contentType(),
                            .headers     = buildHeaders(std::move(headers)),
                            .body        = body.body()};
      }

     private:
      std::string buildHost(AccountNumber account)
      {
         if (account == AccountNumber{})
            account = _account;
         if (account == AccountNumber{})
            return "psibase.io";
         else
            return account.str() + ".psibase.io";
      }
      std::vector<HttpHeader> buildHeaders(std::vector<HttpHeader>&& extra)
      {
         if (_headers.empty())
            return std::move(extra);
         else
         {
            auto result = _headers;
            result.insert(result.begin(), std::move_iterator{extra.begin()},
                          std::move_iterator{extra.end()});
            return result;
         }
      }
      AccountNumber           _account;
      std::vector<HttpHeader> _headers;
   };
   class HttpClient;

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
      bool                              isAutoRun        = true;
      bool                              isPublicChain;

      explicit TestChain(uint32_t chain_id,
                         bool     clone,
                         bool     pub       = true,
                         bool     init      = true,
                         bool     writeable = true);
      void setSignature(BlockNum blockNum, std::vector<char> sig);

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

      static std::string defaultPackageDir();

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
       * By default the TestChain will automatically process
       * the run table and transactions provided by services.
       * When autoRun is disabled, the chain will only run
       * them manually.
       */
      void setAutoRun(bool enable);

      /**
       * Start a new pending block.  If a block is currently pending, finishes it first.
       * May push additional blocks if any time is skipped.
       *
       * @param skip_milliseconds The amount of time to skip in addition to the 1s block time.
       * truncated to a multiple of 1s.
       */
      void startBlock(int64_t skip_miliseconds = 0);

      void startBlock(std::string_view time);

      void startBlock(BlockTime tp);

      /**
       * Finish the current pending block.  If no block is pending, creates an empty block.
       */
      void finishBlock();

      template <typename F>
      void finishBlock(F&& sign)
      {
         finishBlock();
         auto               status = kvGet<StatusRow>(StatusRow::db, statusKey()).value();
         const auto&        head   = status.head.value();
         BlockSignatureInfo preimage{head};
         setSignature(head.header.blockNum, sign(static_cast<std::span<const char>>(preimage)));
      }

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
       * Signs a transaction with the provided keys.
       */
      SignedTransaction signTransaction(Transaction trx, const KeyList& keys = {});

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(const SignedTransaction& signedTrx);

      /**
       * Pushes a transaction onto the chain.  If no block is currently pending, starts one.
       */
      [[nodiscard]] TransactionTrace pushTransaction(Transaction trx, const KeyList& keys = {});

      /**
       * Switches to the block before the new block, and then applies it.
       */
      void pushBlock(const SignedBlock& block);

      /**
       * Runs the nextTransaction callback to find the
       * next transaction and pushes it. If there was
       * a transaction, returns its trace.
       */
      std::optional<TransactionTrace> pushNextTransaction();
      /**
       * Reads the first RunRow and executes it. Returns true
       * if there was anything to do.
       */
      bool runQueueItem();
      /**
       * Runs pending work to completion.
       * - pushNextTransaction
       * - runQueueItem
       */
      void runAll();

      /**
       * Creates a POST request with a JSON body
       */
      template <typename T>
      HttpRequest makePost(AccountNumber                   account,
                           std::string_view                target,
                           const T&                        data,
                           std::optional<std::string_view> token = std::nullopt) const
      {
         HttpRequest req{.host   = account.str() + ".psibase.io",
                         .method = "POST",
                         .target{target},
                         .contentType = "application/json"};
         if (token)
         {
            req.headers.push_back(
                {.name = "Authorization", .value = std::string("Bearer ") + std::string(*token)});
         }
         psio::vector_stream stream{req.body};
         using psio::to_json;
         to_json(data, stream);
         return req;
      }

      /**
       * Creates a POST request
       */
      template <HttpRequestBody T>
      HttpRequest makePost(AccountNumber                   account,
                           std::string_view                target,
                           const T&                        data,
                           std::optional<std::string_view> token = std::nullopt) const
      {
         HttpRequest req{.host   = account.str() + ".psibase.io",
                         .method = "POST",
                         .target{target},
                         .contentType = data.contentType(),
                         .body        = data.body()};
         if (token)
         {
            req.headers.push_back(
                {.name = "Authorization", .value = std::string("Bearer ") + std::string(*token)});
         }
         return req;
      }

      /**
       * Creates a GET request
       */
      HttpRequest makeGet(AccountNumber                   account,
                          std::string_view                target,
                          std::optional<std::string_view> token = std::nullopt) const
      {
         HttpRequest req{.host = account.str() + ".psibase.io", .method = "GET", .target{target}};
         if (token)
         {
            req.headers.push_back(
                {.name = "Authorization", .value = std::string("Bearer ") + std::string(*token)});
         }
         return req;
      }

      HttpClient http(AccountNumber account = {}, std::vector<HttpHeader> headers = {});
      HttpClient http(std::vector<HttpHeader> headers);

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
         return unpackReply<R>(http(request));
      }

      template <typename R = HttpReply, typename T>
      R post(AccountNumber                   account,
             std::string_view                target,
             const T&                        data,
             std::optional<std::string_view> token = std::nullopt)
      {
         return http<R>(makePost(account, target, data, token));
      }

      template <typename R = HttpReply>
      R get(AccountNumber                   account,
            std::string_view                target,
            std::optional<std::string_view> token = std::nullopt)
      {
         return http<R>(makeGet(account, target, token));
      }

      /**
       * Login to a service with an account that uses auth-any (no proofs needed to login)
       */
      std::string login(AccountNumber user, AccountNumber service);

      AsyncHttpReply asyncHttp(const HttpRequest& request);
      template <typename T>
      AsyncHttpReply asyncPost(AccountNumber account, std::string_view target, const T& data)
      {
         return asyncHttp(makePost(account, target, data));
      }
      AsyncHttpReply asyncGet(AccountNumber account, std::string_view target)
      {
         return asyncHttp(makeGet(account, target));
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

      template <typename Other>
      auto to()
      {
         return ServiceUser<Other>(*this, Other::service, Other::service, KeyList{});
      }

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

      std::optional<std::vector<char>> kvGreaterEqualRaw(DbId               db,
                                                         psio::input_stream key,
                                                         uint32_t           matchKeySize);

      template <typename V, typename K>
      inline std::optional<V> kvGreaterEqual(DbId db, const K& key, uint32_t matchKeySize)
      {
         auto v = kvGreaterEqualRaw(db, psio::convert_to_key(key), matchKeySize);
         if (!v)
            return std::nullopt;
         return psio::from_frac<V>(*v);
      }

      void kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value);

      template <typename K, typename V>
      void kvPut(DbId db, const K& key, const V& value)
      {
         kvPutRaw(db, psio::convert_to_key(key), psio::convert_to_frac(value));
      }
   };  // TestChain

   class HttpClient : public HttpRequestBuilder
   {
     public:
      HttpClient(TestChain& chain, AccountNumber account = {}, std::vector<HttpHeader> headers = {})
          : HttpRequestBuilder{account, std::move(headers)}, _chain(&chain)
      {
      }
      template <typename R = HttpReply, HttpRequestBody T>
      auto request(AccountNumber           account,
                   std::string_view        method,
                   std::string_view        target,
                   const T&                body,
                   std::vector<HttpHeader> headers = {})
      {
         auto req = HttpRequestBuilder::request(account, method, target, body, std::move(headers));
         if constexpr (std::is_same_v<R, Default>)
         {
            return _chain->http(req);
         }
         else
         {
            return _chain->http<R>(req);
         }
      }

     private:
      TestChain* _chain;
   };
}  // namespace psibase

template <>
struct Catch::StringMaker<psibase::Checksum256>
{
   static std::string convert(const psibase::Checksum256& obj)
   {
      return psio::hex(obj.begin(), obj.end());
   }
};
