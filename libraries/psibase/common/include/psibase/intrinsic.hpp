#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psio/fracpack.hpp>
#include <psio/to_key.hpp>

#ifdef COMPILING_WASM
#define PSIBASE_INTRINSIC(x) [[clang::import_name(#x)]]
#else
#define PSIBASE_INTRINSIC(x)
#endif

namespace psibase
{
   using EventNumber = uint64_t;

   // These use mangled names instead of extern "C" to prevent collisions
   // with other libraries.
   namespace raw
   {
      // Intrinsics which return data do it by storing it in a result buffer.
      // getResult copies min(dest_size, result_size - offset) bytes from
      // result + offset into dest and returns result_size. If offset >= result_size,
      // then it skips the copy.
      PSIBASE_INTRINSIC(getResult)
      uint32_t getResult(const char* dest, uint32_t dest_size, uint32_t offset);

      // Intrinsics which return keys do it by storing it in a key buffer.
      // getKey copies min(dest_size, key_size) bytes into dest and returns key_size.
      PSIBASE_INTRINSIC(getKey) uint32_t getKey(const char* dest, uint32_t dest_size);

      // Write message to console. Message should be UTF8.
      PSIBASE_INTRINSIC(writeConsole) void writeConsole(const char* message, uint32_t len);

      // Store the currently-executing action into result and return the result size.
      //
      // If the contract, while handling action A, calls itself with action B:
      //    * Before the call to B, getCurrentAction() returns A.
      //    * After the call to B, getCurrentAction() returns B.
      //    * After B returns, getCurrentAction() returns A.
      //
      // Note: The above only applies if the contract uses the call() intrinsic.
      //       The call() function and the action wrappers use the call() intrinsic.
      //       Calling a contract function directly does NOT use the call() intrinsic.
      PSIBASE_INTRINSIC(getCurrentAction) uint32_t getCurrentAction();

      // Call a contract, store the return value into result, and return the result size.
      PSIBASE_INTRINSIC(call) uint32_t call(const char* action, uint32_t len);

      // Set the return value of the currently-executing action
      PSIBASE_INTRINSIC(setRetval) void setRetval(const char* retval, uint32_t len);

      // Set a key-value pair. If key already exists, then replace the existing value.
      PSIBASE_INTRINSIC(kvPut)
      void kvPut(kv_map      map,
                 const char* key,
                 uint32_t    key_len,
                 const char* value,
                 uint32_t    value_len);

      // Add a sequentially-numbered record. Returns the id.
      PSIBASE_INTRINSIC(kvPutSequential)
      EventNumber kvPutSequential(kv_map map, const char* value, uint32_t value_len);

      // Remove a key-value pair if it exists
      PSIBASE_INTRINSIC(kvRemove) void kvRemove(kv_map map, const char* key, uint32_t key_len);

      // Get a key-value pair, if any. If key exists, then sets result to value and
      // returns size. If key does not exist, returns -1 and clears result.
      PSIBASE_INTRINSIC(kvGet) uint32_t kvGet(kv_map map, const char* key, uint32_t key_len);

      // Get a sequentially-numbered record. If id is available, then sets result to value and
      // returns size. If id does not exist, returns -1 and clears result.
      PSIBASE_INTRINSIC(kvGetSequential) uint32_t kvGetSequential(kv_map map, EventNumber id);

      // Get the first key-value pair which is greater than or equal to the provided
      // key. If one is found, and the first match_key_size bytes of the found key
      // matches the provided key, then sets result to value and returns size. Also
      // sets key (use getKey). Otherwise returns -1 and clears result.
      PSIBASE_INTRINSIC(kvGreaterEqual)
      uint32_t kvGreaterEqual(kv_map      map,
                              const char* key,
                              uint32_t    key_len,
                              uint32_t    match_key_size);

      // Get the key-value pair immediately-before provided key. If one is found,
      // and the first match_key_size bytes of the found key matches the provided
      // key, then sets result to value and returns size. Also sets key (use getKey).
      // Otherwise returns -1 and clears result.
      PSIBASE_INTRINSIC(kvLessThan)
      uint32_t kvLessThan(kv_map map, const char* key, uint32_t key_len, uint32_t match_key_size);

      // Get the maximum key-value pair which has key as a prefix. If one is found,
      // then sets result to value and returns size. Also sets key (use getKey).
      // Otherwise returns -1 and clears result.
      PSIBASE_INTRINSIC(kvMax) uint32_t kvMax(kv_map map, const char* key, uint32_t key_len);
   }  // namespace raw

   // Get result when size is known. Caution: this does not verify size.
   std::vector<char> getResult(uint32_t size);

   // Get result when size is unknown
   std::vector<char> getResult();

   // Get key
   std::vector<char> getKey();

   // Get the currently-executing action.
   //
   // If the contract, while handling action A, calls itself with action B:
   //    * Before the call to B, getCurrentAction() returns A.
   //    * After the call to B, getCurrentAction() returns B.
   //    * After B returns, getCurrentAction() returns A.
   //
   // Note: The above only applies if the contract uses the call() intrinsic.
   //       The call() function and the action wrappers use the call() intrinsic.
   //       Calling a contract function directly does NOT use the call() intrinsic.
   Action                        getCurrentAction();
   psio::shared_view_ptr<Action> getCurrentActionView();

   // Call a contract and return its result
   std::vector<char> call(const char* action, uint32_t len);

   // Call a contract and return its result
   std::vector<char> call(psio::input_stream action);

   // Call a contract and return its result
   std::vector<char> call(const Action& action);

   // Set the return value of the currently-executing action
   template <typename T>
   void setRetval(const T& retval)
   {
      auto data = psio::convert_to_frac(retval);
      raw::setRetval(data.data(), data.size());
   }

   // Set the return value of the currently-executing action
   inline void setRetvalBytes(psio::input_stream s)
   {
      raw::setRetval(s.pos, s.remaining());
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   inline void kvPutRaw(kv_map map, psio::input_stream key, psio::input_stream value)
   {
      raw::kvPut(map, key.pos, key.remaining(), value.pos, value.remaining());
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   template <typename K, typename V>
   auto kvPut(kv_map map, const K& key, const V& value)
       -> std::enable_if_t<!psio::is_std_optional<V>(), void>
   {
      kvPutRaw(map, psio::convert_to_key(key), psio::convert_to_frac(value));
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   template <typename K, typename V>
   auto kvPut(const K& key, const V& value) -> std::enable_if_t<!psio::is_std_optional<V>(), void>
   {
      kvPut(kv_map::contract, key, value);
   }

   // Add a sequentially-numbered record. Returns the id.
   inline uint64_t kvPutSequentialRaw(kv_map map, psio::input_stream value)
   {
      return raw::kvPutSequential(map, value.pos, value.remaining());
   }

   // Add a sequentially-numbered record. Returns the id.
   template <typename Type, typename V>
   auto kvPutSequential(kv_map map, AccountNumber contract, Type type, const V& value)
       -> std::enable_if_t<!psio::is_std_optional<V>(), void>
   {
      std::vector<char>     packed(psio::fracpack_size(contract) + psio::fracpack_size(type) +
                                   psio::fracpack_size(value));
      psio::fast_buf_stream stream(packed.data(), packed.size());
      psio::fracpack(contract, stream);
      psio::fracpack(type, stream);
      psio::fracpack(value, stream);
      return kvPutSequentialRaw(map, packed);
   }

   // Remove a key-value pair if it exists
   inline void kvRemoveRaw(kv_map map, psio::input_stream key)
   {
      raw::kvRemove(map, key.pos, key.remaining());
   }

   // Remove a key-value pair if it exists
   template <typename K>
   void kvRemove(kv_map map, const K& key)
   {
      kvRemoveRaw(map, psio::convert_to_key(key));
   }

   // Remove a key-value pair if it exists
   template <typename K>
   void kvRemove(const K& key)
   {
      kvRemove(kv_map::contract, key);
   }

   // Size of key-value pair, if any
   inline std::optional<uint32_t> kvGetSizeRaw(kv_map map, psio::input_stream key)
   {
      auto size = raw::kvGet(map, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return size;
   }

   // Size of key-value pair, if any
   template <typename K>
   inline std::optional<uint32_t> kvGetSize(kv_map map, const K& key)
   {
      return kvGetSizeRaw(map, psio::convert_to_key(key));
   }

   // Size of key-value pair, if any
   template <typename K>
   inline std::optional<uint32_t> kvGetSize(const K& key)
   {
      return kvGetSize(kv_map::contract, key);
   }

   // Get a key-value pair, if any
   inline std::optional<std::vector<char>> kvGetRaw(kv_map map, psio::input_stream key)
   {
      auto size = raw::kvGet(map, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   // Get a key-value pair, if any
   template <typename V, typename K>
   inline std::optional<V> kvGet(kv_map map, const K& key)
   {
      auto v = kvGetRaw(map, psio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get a key-value pair, if any
   template <typename V, typename K>
   inline std::optional<V> kvGet(const K& key)
   {
      return kvGet<V>(kv_map::contract, key);
   }

   // Get a value, or the default if not found
   template <typename V, typename K>
   inline V kvGetOrDefault(kv_map map, const K& key)
   {
      auto obj = kvGet<V>(map, key);
      if (obj)
         return std::move(*obj);
      return {};
   }

   // Get a value, or the default if not found
   template <typename V, typename K>
   inline V kvGetOrDefault(const K& key)
   {
      return kvGetOrDefault<V>(kv_map::contract, key);
   }

   // Get a sequentially-numbered record, if available
   inline std::optional<std::vector<char>> kvGetSequentialRaw(kv_map map, uint64_t id)
   {
      auto size = raw::kvGetSequential(map, id);
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   // Get a sequentially-numbered record, if available.
   // * If matchContract is non-null, and the record wasn't written by matchContract, then return nullopt.
   //   This prevents a spurious abort from mismatched serialization.
   // * If matchType is non-null, and the record type doesn't match, then return nullopt.
   //   This prevents a spurious abort from mismatched serialization.
   // * If contract is non-null, then it receives the contract that wrote the record. It is
   //   left untouched if the record is not available.
   // * If type is non-null, then it receives the record type. It is left untouched if either the record
   //   is not available or if matchContract is not null but doesn't match.
   template <typename V, typename Type>
   inline std::optional<V> kvGetSequential(kv_map               map,
                                           uint64_t             id,
                                           const AccountNumber* matchContract = nullptr,
                                           const Type*          matchType     = nullptr,
                                           AccountNumber*       contract      = nullptr,
                                           Type*                type          = nullptr)
   {
      std::optional<V> result;
      auto             v = kvGetSequentialRaw(map, id);
      if (!v)
         return result;
      psio::input_stream stream(v->data(), v->size());

      AccountNumber c;
      fracunpack(c, stream);
      if (contract)
         *contract = c;
      if (matchContract && *matchContract != c)
         return result;

      Type t;
      fracunpack(t, stream);
      if (type)
         *type = t;
      if (matchType && *matchType != t)
         return result;

      result.emplace();
      // TODO: validate (allow opt-in or opt-out)
      fracunpack(*result, stream);
      return result;
   }

   // Get the first key-value pair which is greater than or equal to the provided key. If one is
   // found, and the first match_key_size bytes of the found key matches the provided key, then
   // returns the value. Also sets key (use getKey). Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_greater_equal_raw(kv_map             map,
                                                                psio::input_stream key,
                                                                uint32_t           match_key_size)
   {
      auto size = raw::kvGreaterEqual(map, key.pos, key.remaining(), match_key_size);
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   // Get the first key-value pair which is greater than or equal to the provided key. If one is
   // found, and the first match_key_size bytes of the found key matches the provided key, then
   // returns the value. Also sets key (use getKey). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kvGreaterEqual(kv_map map, const K& key, uint32_t match_key_size)
   {
      auto v = kv_greater_equal_raw(map, psio::convert_to_key(key), match_key_size);
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get the first key-value pair which is greater than or equal to the provided key. If one is
   // found, and the first match_key_size bytes of the found key matches the provided key, then
   // returns the value. Also sets key (use getKey). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kvGreaterEqual(const K& key, uint32_t match_key_size)
   {
      return kvGreaterEqual<V>(kv_map::contract, key, match_key_size);
   }

   // Get the key-value pair immediately-before provided key. If one is found, and the first
   // match_key_size bytes of the found key matches the provided key, then returns the value.
   // Also sets key (use getKey). Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_less_than_raw(kv_map             map,
                                                            psio::input_stream key,
                                                            uint32_t           match_key_size)
   {
      auto size = raw::kvLessThan(map, key.pos, key.remaining(), match_key_size);
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   // Get the key-value pair immediately-before provided key. If one is found, and the first
   // match_key_size bytes of the found key matches the provided key, then returns the value.
   // Also sets key (use getKey). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kvLessThan(kv_map map, const K& key, uint32_t match_key_size)
   {
      auto v = kv_less_than_raw(map, psio::convert_to_key(key), match_key_size);
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get the key-value pair immediately-before provided key. If one is found, and the first
   // match_key_size bytes of the found key matches the provided key, then returns the value.
   // Also sets key (use getKey). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kvLessThan(const K& key, uint32_t match_key_size)
   {
      return kvLessThan<V>(kv_map::contract, key, match_key_size);
   }

   // Get the maximum key-value pair which has key as a prefix. If one is found, then returns the
   // value. Also sets key (use getKey). Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_max_raw(kv_map map, psio::input_stream key)
   {
      auto size = raw::kvMax(map, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return getResult(size);
   }

   // Get the maximum key-value pair which has key as a prefix. If one is found, then returns the
   // value. Also sets key (use getKey). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kvMax(kv_map map, const K& key)
   {
      auto v = kv_max_raw(map, psio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get the maximum key-value pair which has key as a prefix. If one is found, then returns the
   // value. Also sets key (use getKey). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kvMax(const K& key)
   {
      return kvMax<V>(kv_map::contract, key);
   }

   inline void writeConsole(const std::string_view& sv)
   {
      raw::writeConsole(sv.data(), sv.size());
   }

}  // namespace psibase

#undef PSIBASE_INTRINSIC
