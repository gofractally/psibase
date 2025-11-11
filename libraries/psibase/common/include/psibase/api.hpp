#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psio/fracpack.hpp>
#include <psio/to_key.hpp>
#include <span>

#ifdef COMPILING_WASM
#define PSIBASE_NATIVE(x) [[clang::import_name(#x)]]
#else
#define PSIBASE_NATIVE(x)
#endif

namespace psibase
{
   using EventNumber = uint64_t;

   template <typename T>
   concept NotOptional = std::is_base_of<std::false_type, psio::is_std_optional<T>>::value;

   enum class CallFlags : std::uint64_t
   {
      none = 0,

      /// Switch to RPC mode.
      ///
      /// On the block producer, save the result. On replay, skip execution
      /// and return the same result as the block producer.
      ///
      /// Can only be used in a transaction.
      ///
      /// All services called during subjective execution will be instantiated
      /// in a separate namespace. Thus, if a service is called normally and
      /// also during subjective execution, it will be instantiated twice.
      ///
      /// It is unspecified whether services that have been used in earlier
      /// subjective calls in the same transaction will be instantiated again.
      runModeRpc = 1,

      /// Switch to callback mode.
      ///
      /// On the block producer, save the result. On replay, suppress errors,
      /// ignore the return value, and return the same result as the block
      /// producer.
      ///
      /// Can only be used in a transaction.
      ///
      /// All services called during subjective execution will be instantiated
      /// in a separate namespace. Thus, if a service is called normally and
      /// also during subjective execution, it will be instantiated twice.
      ///
      /// It is unspecified whether services that have been used in earlier
      /// subjective calls in the same transaction will be instantiated again.
      runModeCallback = 2,
   };

   // These use mangled names instead of extern "C" to prevent collisions
   // with other libraries.
   namespace raw
   {
      /// Copy `min(destSize, resultSize - offset)` bytes from
      /// `result + offset` into `dest` and return `resultSize`
      ///
      /// If `offset >= resultSize`, then skip the copy.
      ///
      /// Other functions set or clear result. `getResult`, [getKey], and
      /// [writeConsole] are the only raw functions which leave the current
      /// result and key intact.
      PSIBASE_NATIVE(getResult)
      uint32_t getResult(const char* dest, uint32_t destSize, uint32_t offset);

      /// Copy `min(destSize, key_size)` bytes of the most-recent key into
      /// dest and return `key_size`
      ///
      /// Other functions set or clear the key. [getResult], `getKey`, and
      /// [writeConsole] are the only raw functions which leave the current
      /// result and key intact.
      PSIBASE_NATIVE(getKey) uint32_t getKey(const char* dest, uint32_t destSize);

      /// Write `message` to console
      ///
      /// Message should be UTF8.
      PSIBASE_NATIVE(writeConsole) void writeConsole(const char* message, uint32_t len);

      /// Store the currently-executing action into result and return the result size
      ///
      /// The result contains a fracpacked [Action]; use [getResult] to get it.
      ///
      /// If the service, while handling action A, calls itself with action B:
      /// * Before the call to B, `getCurrentAction()` returns A.
      /// * After the call to B, `getCurrentAction()` returns B.
      /// * After B returns, `getCurrentAction()` returns A.
      ///
      /// Note: The above only applies if the service uses [call]. [Actor] uses [call].
      PSIBASE_NATIVE(getCurrentAction) uint32_t getCurrentAction();

      /// Call a service, store the return value into result, and return the result size
      ///
      /// `action` must contain a fracpacked [Action].
      ///
      /// Use [getResult] to get result.
      PSIBASE_NATIVE(call) uint32_t call(const char* action, uint32_t len, CallFlags flags);

      /// Set the return value of the currently-executing action
      PSIBASE_NATIVE(setRetval) void setRetval(const char* retval, uint32_t len);

      /// Opens a key-value database
      ///
      /// The prefix will be added automatically to all accesses using the handle.
      ///
      /// Access control is checked at open:
      /// - Native databases can only be opened by privileged services
      /// - For regular databases, the first 8 bytes of the prefix must be the
      ///   caller service (big endian)
      /// - Some databases forbid reading or writing depending on the run mode
      ///
      /// The maximum number of handles that a service can have open
      /// simultaneously is `WasmConfigRow::maxHandles`. If the limit
      /// is exceeded, this function will abort.
      ///
      /// The handle is only usable by the current service. Use `exportHandles`
      /// to pass it to another service.
      PSIBASE_NATIVE(kvOpen)
      KvHandle kvOpen(DbId db, const char* prefix, uint32_t len, KvMode mode);

      /// Opens a subtree of a key-value database
      ///
      /// - The prefix will be appended to any prefix that the source has
      /// - The mode must be at least as restrictive as the source mode
      ///
      /// The maximum number of handles that a service can have open
      /// simultaneously is `WasmConfigRow::maxHandles`. If the limit
      /// is exceeded, this function will abort.
      PSIBASE_NATIVE(kvOpenAt)
      KvHandle kvOpenAt(KvHandle db, const char* prefix, uint32_t len, KvMode mode);

      /// Closes a key-value database
      ///
      /// If the handle was exported, all copies are unaffected and
      /// will remain usable until they are also closed.
      PSIBASE_NATIVE(kvClose) void kvClose(KvHandle handle);

      /// Copies handles across the next call or return.
      ///
      /// If exportHandles is called more than once, the value set by the
      /// last call will be used. The export set is distinct from the import
      /// set. When entering or returning to a service, the export set always
      /// starts empty.
      ///
      /// Handles cannot be exported across a boundary that changes the run mode.
      ///
      /// `handles` must contain a fracpacked `vector<KvHandle>`.
      PSIBASE_NATIVE(exportHandles) void exportHandles(const char* handles, uint32_t len);

      /// Loads handles from the caller or the last callee.
      ///
      /// The result is a fracpacked `vector<KvHandle>`. Handles are
      /// scoped to a single service, and their representation in this
      /// service is not the same as the representation in the service
      /// that provided them.
      ///
      /// This function clears the import set. Subsequent calls will
      /// return an empty list.
      ///
      /// The maximum number of handles that a service can have open
      /// simultaneously is `WasmConfigRow::maxHandles`. If the limit
      /// is exceeded, this function will abort.
      ///
      /// Use [getResult] to get result.
      PSIBASE_NATIVE(importHandles) uint32_t importHandles();

      /// Set a key-value pair
      ///
      /// If key already exists, then replace the existing value.
      PSIBASE_NATIVE(kvPut)
      void kvPut(KvHandle    db,
                 const char* key,
                 uint32_t    keyLen,
                 const char* value,
                 uint32_t    valueLen);

      /// Add a sequentially-numbered record
      ///
      /// Returns the id.
      PSIBASE_NATIVE(putSequential)
      uint64_t putSequential(DbId db, const char* value, uint32_t valueLen);

      /// Remove a key-value pair if it exists
      PSIBASE_NATIVE(kvRemove) void kvRemove(KvHandle db, const char* key, uint32_t keyLen);

      /// Get a key-value pair, if any
      ///
      /// If key exists, then sets result to value and returns size. If key does not
      /// exist, returns `-1` and clears result. Use [getResult] to get result.
      PSIBASE_NATIVE(kvGet) uint32_t kvGet(KvHandle db, const char* key, uint32_t keyLen);

      /// Get a sequentially-numbered record
      ///
      /// If `id` is available, then sets result to value and returns size. If id does
      /// not exist, returns -1 and clears result.
      PSIBASE_NATIVE(getSequential) uint32_t getSequential(DbId db, uint64_t id);

      /// Get the first key-value pair which is greater than or equal to the provided
      /// key
      ///
      /// If one is found, and the first `matchKeySize` bytes of the found key
      /// matches the provided key, then sets result to value and returns size. Also
      /// sets key. Otherwise returns `-1` and clears result. Use [getResult] to get
      /// result and [getKey] to get found key.
      PSIBASE_NATIVE(kvGreaterEqual)
      uint32_t kvGreaterEqual(KvHandle db, const char* key, uint32_t keyLen, uint32_t matchKeySize);

      /// Get the key-value pair immediately-before provided key
      ///
      /// If one is found, and the first `matchKeySize` bytes of the found key
      /// matches the provided key, then sets result to value and returns size.
      /// Also sets key. Otherwise returns `-1` and clears result. Use [getResult]
      /// to get result and [getKey] to get found key.
      PSIBASE_NATIVE(kvLessThan)
      uint32_t kvLessThan(KvHandle db, const char* key, uint32_t keyLen, uint32_t matchKeySize);

      /// Get the maximum key-value pair which has key as a prefix
      ///
      /// If one is found, then sets result to value and returns size. Also sets key.
      /// Otherwise returns `-1` and clears result. Use [getResult] to get result
      /// and [getKey] to get found key.
      PSIBASE_NATIVE(kvMax) uint32_t kvMax(KvHandle db, const char* key, uint32_t keyLen);

      /// Gets the current value of a clock in nanoseconds.
      ///
      /// This function is non-deterministic and is only available in subjective services.
      ///
      /// The following clocks are supported
      /// - `__WASI_CLOCKID_REALTIME` returns wall-clock time since the unix epoch.
      /// - `__WASI_CLOCKID_MONOTONIC` returns monotonic time since an unspecified epoch.
      ///   All uses of CLOCK_MONOTONIC within the same block use the same epoch.
      /// - `__WASI_CLOCKID_PROCESS_CPUTIME_ID` measures CPU time spent executing the
      ///   current transaction.
      ///
      /// Returns 0 on success or an error code on failure.
      ///
      /// Errors:
      /// - `EINVAL`: the clock id is not supported
      int32_t clockTimeGet(uint32_t id, uint64_t* time);

      /// Fills a buffer with random bytes
      ///
      /// This function is non-deterministic and is only available in subjective services.
      PSIBASE_NATIVE(getRandom) void getRandom(void* buf, std::uint32_t len);

      /// Sets the transaction timer to expire a given number of nanoseconds
      /// after the beginning of the current transaction.
      PSIBASE_NATIVE(setMaxTransactionTime) void setMaxTransactionTime(uint64_t ns);

      /// Loads the subjective database
      ///
      /// - The subjective database may not be accessed without calling this first
      /// - If the subjective database is already checked out, this will create a nested checkout
      /// - If an action checks out the subjective database and does not commit it before
      ///   returning, any changes will be discarded.
      ///
      /// There exists a total ordering of all top-level checkouts. Every read of the subjective
      /// database returns the most recent write in the current checkout or in previous checkouts
      /// that were successfully committed.
      ///
      /// The following state is controlled by checkoutSubjective
      /// - DbId::subjective
      /// - Socket auto-close
      ///
      /// State that is not affected includes
      /// - Databases that follow forks
      /// - WASM linear memory
      /// - Socket messages sent
      PSIBASE_NATIVE(checkoutSubjective) void checkoutSubjective();
      /// Attempts to commit changes to the subjective database
      ///
      /// - If changes were committed successfully, returns true and closes the subjective database
      /// - If changes were not successfully committed, returns false and reloads the subjective database, starting a new checkout
      /// - It is an error if the current action did not check out the subjective database
      ///
      /// If there were no writes to the subjective database or if this is a nested checkout, commit always succeeds.
      PSIBASE_NATIVE(commitSubjective) bool commitSubjective();
      /// Closes the current checkout and discards any changes made to
      /// the subjective database
      PSIBASE_NATIVE(abortSubjective) void abortSubjective();

      /// Starts a new HTTP request
      ///
      /// Returns a socket on success or a negative error code on failure
      ///
      /// Errors:
      /// - `ENOSYS`: the host does not support sockets
      PSIBASE_NATIVE(socketOpen)
      std::int32_t socketOpen(const void* data, std::size_t size);

      /// Send a message to a socket
      ///
      /// Returns 0 on success or an error code on failure
      ///
      /// Errors:
      /// - `EBADF`: fd is not a valid file descriptor
      /// - `ENOTSOCK`: fd is not a socket
      PSIBASE_NATIVE(socketSend)
      std::int32_t socketSend(std::int32_t fd, const void* data, std::size_t size);

      /// Tells the current transaction/query/callback context to take or release
      /// ownership of a socket.
      ///
      /// Any sockets that are owned by a context will be closed when it finishes.
      /// - HTTP socket: send a 500 response with an error message in the body
      /// - Other sockets may not be set to auto-close
      ///
      /// If this function is called within a subjectiveCheckout, it will only take
      /// effect if the top-level commit succeeds. If another context takes ownership
      /// of the socket, subjectiveCommit may fail.
      ///
      /// Returns 0 on success or an error code on failure.
      ///
      /// Errors:
      /// - `EBADF`: fd is not a valid file descriptor
      /// - `ENOTSUP`: The socket does not support auto-close
      /// - `ENOTSOCK`: fd is not a socket
      /// - `EACCES`: The socket is owned by another context
      PSIBASE_NATIVE(socketAutoClose)
      std::int32_t socketAutoClose(std::int32_t fd, bool value);
   }  // namespace raw

   /// Get result
   ///
   /// Other functions set result.
   std::vector<char> getResult();

   /// Get result when size is known
   ///
   /// Other functions set result.
   ///
   /// Caution: this does not verify size.
   std::vector<char> getResult(uint32_t size);

   /// Get key
   ///
   /// Other functions set the key.
   std::vector<char> getKey();

   /// Get the currently-executing action
   ///
   /// This function unpacks the data into the [Action] struct. For large
   /// data, [getCurrentActionView] can be more efficient.
   ///
   /// If the service, while handling action A, calls itself with action B:
   /// * Before the call to B, `getCurrentAction()` returns A.
   /// * After the call to B, `getCurrentAction()` returns B.
   /// * After B returns, `getCurrentAction()` returns A.
   ///
   /// Note: The above only applies if the service uses [call]. [Actor] uses [call].
   Action getCurrentAction();

   /// Get the currently-executing action
   ///
   /// This function creates a view, which can save time for large data. For small
   /// data, [getCurrentAction] can be more efficient.
   ///
   /// If the service, while handling action A, calls itself with action B:
   /// * Before the call to B, `getCurrentAction()` returns A.
   /// * After the call to B, `getCurrentAction()` returns B.
   /// * After B returns, `getCurrentAction()` returns A.
   ///
   /// Note: The above only applies if the service uses [call]. [Actor] uses [call].
   psio::shared_view_ptr<Action> getCurrentActionView();

   /// Call a service and return its result
   std::vector<char> call(const Action& action, CallFlags flags = CallFlags::none);

   /// Call a service and return its result
   ///
   /// `action` must contain a fracpacked [Action].
   std::vector<char> call(const char* action, uint32_t len, CallFlags flags = CallFlags::none);

   /// Call a service and return its result
   ///
   /// `action` must contain a fracpacked [Action].
   std::vector<char> call(psio::input_stream action, CallFlags flags = CallFlags::none);

   /// Set the return value of the currently-executing action
   template <typename T>
   void setRetval(const T& retval)
   {
      auto data = psio::convert_to_frac(retval);
      raw::setRetval(data.data(), data.size());
   }

   /// Set the return value of the currently-executing action
   inline void setRetvalBytes(psio::input_stream s)
   {
      raw::setRetval(s.pos, s.remaining());
   }

   /// Opens a key-value database
   ///
   /// The prefix will be added automatically to all accesses using the handle.
   ///
   /// Access control is checked at open:
   /// - Native databases can only be opened by privileged services
   /// - For regular databases, the first 8 bytes of the prefix must be the
   ///   caller service (big endian)
   /// - Some databases forbid reading or writing depending on the run mode
   ///
   /// The maximum number of handles that a service can have open
   /// simultaneously is `WasmConfigRow::maxHandles`. If the limit
   /// is exceeded, this function will abort.
   ///
   /// The handle is only usable by the current service. Use `exportHandles`
   /// to pass it to another service.
   inline KvHandle kvOpen(DbId db, psio::input_stream prefix, KvMode mode)
   {
      return raw::kvOpen(db, prefix.pos, prefix.remaining(), mode);
   }

   /// Opens a subtree of a key-value database
   ///
   /// - The prefix will be appended to any prefix that the source has
   /// - The mode must be at least as restrictive as the source mode
   ///
   /// The maximum number of handles that a service can have open
   /// simultaneously is `WasmConfigRow::maxHandles`. If the limit
   /// is exceeded, this function will abort.
   inline KvHandle kvOpen(KvHandle handle, psio::input_stream prefix, KvMode mode)
   {
      return raw::kvOpenAt(handle, prefix.pos, prefix.remaining(), mode);
   }

   /// Closes a key-value database
   inline void kvClose(KvHandle handle)
   {
      raw::kvClose(handle);
   }

   /// Copies handles across the next call or return.
   ///
   /// If exportHandles is called more than once, the value set by the
   /// last call will be used. The export set is distinct from the import
   /// set. When entering or returning to a service, the export set always
   /// starts empty.
   ///
   /// Handles cannot be exported across a boundary that changes the run mode.
   inline void exportHandles(std::span<const KvHandle> handles)
   {
      auto packed = psio::to_frac(handles);
      raw::exportHandles(packed.data(), packed.size());
   }

   /// Loads handles from the caller or the last callee.
   ///
   /// Handles are scoped to a single service, and their representation
   /// in this service is not the same as the representation in the service
   /// that provided them.
   ///
   /// This function clears the import set. Subsequent calls will
   /// return an empty list.
   ///
   /// The maximum number of handles that a service can have open
   /// simultaneously is `WasmConfigRow::maxHandles`. If the limit
   /// is exceeded, this function will abort.
   inline std::vector<KvHandle> importHandles()
   {
      auto size = raw::importHandles();
      if (size == -1)
         return {};
      return psio::from_frac<std::vector<KvHandle>>(getResult(size));
   }

   /// Set a key-value pair
   ///
   /// If key already exists, then replace the existing value.
   inline void kvPutRaw(KvHandle db, psio::input_stream key, psio::input_stream value)
   {
      raw::kvPut(db, key.pos, key.remaining(), value.pos, value.remaining());
   }

   /// Set a key-value pair
   ///
   /// If key already exists, then replace the existing value.
   template <typename K, NotOptional V>
   void kvPut(KvHandle db, const K& key, const V& value)
   {
      kvPutRaw(db, psio::convert_to_key(key), psio::convert_to_frac(value));
   }

   /// Add a sequentially-numbered record
   ///
   /// Returns the id.
   inline uint64_t putSequentialRaw(DbId db, psio::input_stream value)
   {
      return raw::putSequential(db, value.pos, value.remaining());
   }

   template <typename Type, NotOptional V = void>
   struct SequentialRecord
   {
      AccountNumber       service;
      std::optional<Type> type;
      std::optional<V>    value;
      PSIO_REFLECT(SequentialRecord, service, type, value);
   };

   template <typename Type>
   struct SequentialRecord<Type, void>
   {
      AccountNumber       service;
      std::optional<Type> type;
      PSIO_REFLECT(SequentialRecord, service, type);
   };

   /// Add a sequentially-numbered record
   ///
   /// Returns the id.
   template <typename Type, NotOptional V>
   uint64_t putSequential(DbId db, AccountNumber service, Type type, const V& value)
   {
      return putSequentialRaw(db, psio::to_frac(SequentialRecord<Type, V>{service, type, value}));
   }

   /// Remove a key-value pair if it exists
   inline void kvRemoveRaw(KvHandle db, psio::input_stream key)
   {
      raw::kvRemove(db, key.pos, key.remaining());
   }

   /// Remove a key-value pair if it exists
   template <typename K>
   void kvRemove(KvHandle db, const K& key)
   {
      kvRemoveRaw(db, psio::convert_to_key(key));
   }

   /// Get size of stored value, if any
   inline std::optional<uint32_t> kvGetSizeRaw(KvHandle db, psio::input_stream key)
   {
      auto size = raw::kvGet(db, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return size;
   }

   /// Get size of stored value, if any
   template <typename K>
   inline std::optional<uint32_t> kvGetSize(KvHandle db, const K& key)
   {
      return kvGetSizeRaw(db, psio::convert_to_key(key));
   }

   /// Get a key-value pair, if any
   inline std::optional<std::vector<char>> kvGetRaw(KvHandle db, psio::input_stream key)
   {
      auto size = raw::kvGet(db, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   /// Get a key-value pair, if any
   template <typename V, typename K>
   inline std::optional<V> kvGet(KvHandle db, const K& key)
   {
      auto v = kvGetRaw(db, psio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::from_frac<V>(psio::prevalidated{*v});
   }

   /// Get a value, or the default if not found
   template <typename V, typename K>
   inline V kvGetOrDefault(KvHandle db, const K& key)
   {
      auto obj = kvGet<V>(db, key);
      if (obj)
         return std::move(*obj);
      return {};
   }

   /// Get a sequentially-numbered record, if available
   inline std::optional<std::vector<char>> getSequentialRaw(DbId db, uint64_t id)
   {
      auto size = raw::getSequential(db, id);
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   /// Get a sequentially-numbered record, if available
   ///
   /// * If `matchService` is non-null, and the record wasn't written by `matchService`, then return nullopt.
   ///   This prevents a spurious abort from mismatched serialization.
   /// * If `matchType` is non-null, and the record type doesn't match, then return nullopt.
   ///   This prevents a spurious abort from mismatched serialization.
   /// * If `service` is non-null, then it receives the service that wrote the record. It is
   ///   left untouched if the record is not available.
   /// * If `type` is non-null, then it receives the record type. It is left untouched if either the record
   ///   is not available or if `matchService` is not null but doesn't match.
   template <typename V, typename Type>
   inline std::optional<V> getSequential(DbId                 db,
                                         uint64_t             id,
                                         const AccountNumber* matchService = nullptr,
                                         const Type*          matchType    = nullptr,
                                         AccountNumber*       service      = nullptr,
                                         Type*                type         = nullptr)
   {
      auto v = getSequentialRaw(db, id);
      if (!v)
         return {};

      auto [c, t] = psio::from_frac<SequentialRecord<Type>>(*v);

      if (service)
         *service = c;
      if (matchService && *matchService != c)
         return {};

      if (!t)
         return {};
      if (type)
         *type = *t;
      if (matchType && *matchType != *t)
         return {};

      return psio::view<SequentialRecord<Type, V>>{*v}.value().unpack();
   }

   /// Get the first key-value pair which is greater than or equal to `key`
   ///
   /// If one is found, and the first `matchKeySize` bytes of the found key
   /// matches the provided key, then returns the value. Use [getKey] to
   /// get the found key.
   inline std::optional<std::vector<char>> kvGreaterEqualRaw(KvHandle           db,
                                                             psio::input_stream key,
                                                             uint32_t           matchKeySize)
   {
      auto size = raw::kvGreaterEqual(db, key.pos, key.remaining(), matchKeySize);
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   /// Get the first key-value pair which is greater than or equal to `key`
   ///
   /// If one is found, and the first `matchKeySize` bytes of the found key
   /// matches the provided key, then returns the value. Use [getKey] to
   /// get the found key.
   template <typename V, typename K>
   inline std::optional<V> kvGreaterEqual(KvHandle db, const K& key, uint32_t matchKeySize)
   {
      auto v = kvGreaterEqualRaw(db, psio::convert_to_key(key), matchKeySize);
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::from_frac<V>(psio::prevalidated{*v});
   }

   /// Get the key-value pair immediately-before provided key
   ///
   /// If one is found, and the first `matchKeySize` bytes of the found key
   /// matches the provided key, then returns the value. Use [getKey] to
   /// get the found key.
   inline std::optional<std::vector<char>> kvLessThanRaw(KvHandle           db,
                                                         psio::input_stream key,
                                                         uint32_t           matchKeySize)
   {
      auto size = raw::kvLessThan(db, key.pos, key.remaining(), matchKeySize);
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   /// Get the key-value pair immediately-before provided key
   ///
   /// If one is found, and the first `matchKeySize` bytes of the found key
   /// matches the provided key, then returns the value. Use [getKey] to
   /// get the found key.
   template <typename V, typename K>
   inline std::optional<V> kvLessThan(KvHandle db, const K& key, uint32_t matchKeySize)
   {
      auto v = kvLessThanRaw(db, psio::convert_to_key(key), matchKeySize);
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::from_frac<V>(psio::prevalidated{*v});
   }

   /// Get the maximum key-value pair which has key as a prefix
   ///
   /// If one is found, then returns the value. Use [getKey] to
   /// get the found key.
   inline std::optional<std::vector<char>> kvMaxRaw(KvHandle db, psio::input_stream key)
   {
      auto size = raw::kvMax(db, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   /// Get the maximum key-value pair which has key as a prefix
   ///
   /// If one is found, then returns the value. Use [getKey] to
   /// get the found key.
   template <typename V, typename K>
   inline std::optional<V> kvMax(KvHandle db, const K& key)
   {
      auto v = kvMaxRaw(db, psio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::from_frac<V>(psio::prevalidated{*v});
   }

   /// Write `message` to console
   ///
   /// Message should be UTF8.
   inline void writeConsole(const std::string_view& sv)
   {
      raw::writeConsole(sv.data(), sv.size());
   }

   using raw::abortSubjective;
   using raw::checkoutSubjective;
   using raw::commitSubjective;

   struct SubjectiveTransaction
   {
      SubjectiveTransaction() { psibase::checkoutSubjective(); }
      ~SubjectiveTransaction()
      {
         if (!done)
         {
            psibase::abortSubjective();
         }
      }
      void commit()
      {
         if (!done)
         {
            done = psibase::commitSubjective();
         }
      }
      bool done = false;
   };

   /// The `PSIBASE_SUBJECTIVE_TX` macro creates a scope in which
   /// the subjective database is accessible. It is necessary to use
   /// this scope for any reads or writes to the subjective database.
   ///
   /// ```
   /// PSIBASE_SUBJECTIVE_TX stmt
   /// ```
   ///
   /// The statement will be executed one or more times until
   /// it is successfully committed.
   ///
   /// Unstructured control flow that exits the statement, including break,
   /// return, and exceptions, will discard any changes made to the
   /// subjective database.
#define PSIBASE_SUBJECTIVE_TX \
   for (::psibase::SubjectiveTransaction _psibase_s_tx; !_psibase_s_tx.done; _psibase_s_tx.commit())

   struct HttpRequest;
   struct IPV4Endpoint;
   struct IPV6Endpoint;
   struct LocalEndpoint;
   struct TLSInfo;
   std::int32_t socketOpen(const HttpRequest& request);
   std::int32_t socketOpen(const HttpRequest& request, const std::optional<TLSInfo>& tls);
   std::int32_t socketOpen(
       const HttpRequest&                                                            request,
       const std::optional<TLSInfo>&                                                 tls,
       const std::optional<std::variant<IPV4Endpoint, IPV6Endpoint, LocalEndpoint>>& endpoint);

   /// Send a message to a socket
   ///
   /// Returns 0 on success. On failure returns -1 and sets errno.
   ///
   /// Errors:
   /// - `EBADF`: fd is not a valid file descriptor
   /// - `ENOTSOCK`: fd is not a socket
   inline int socketSend(int fd, std::span<const char> data)
   {
      if (auto err = raw::socketSend(fd, data.data(), data.size()))
      {
         errno = err;
         return -1;
      }
      return 0;
   }
   static constexpr int producer_multicast = 0;

   /// Tells the current transaction/query/callback context to take or release
   /// ownership of a socket.
   ///
   /// Any sockets that are owned by a context will be closed when it finishes.
   /// - HTTP socket: send a 500 response with an error message in the body
   /// - Other sockets may not be set to auto-close
   ///
   /// If this function is called within a subjectiveCheckout, it will only take
   /// effect if the top-level commit succeeds. If another context takes ownership
   /// of the socket, subjectiveCommit may fail.
   ///
   /// Returns 0 on success. On failure returns -1 and sets errno.
   ///
   /// Errors:
   /// - `EBADF`: fd is not a valid file descriptor
   /// - `ENOTSUP`: The socket does not support auto-close
   /// - `ENOTSOCK`: fd is not a socket
   /// - `EACCES`: The socket is owned by another context
   inline int socketAutoClose(std::int32_t fd, bool value)
   {
      if (auto err = raw::socketAutoClose(fd, value))
      {
         errno = err;
         return -1;
      }
      return 0;
   }

}  // namespace psibase

#undef PSIBASE_NATIVE
