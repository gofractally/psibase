#pragma once

#include <eosio/to_key.hpp>
#include <psibase/AccountNumber.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>
#include <psio/fracpack.hpp>

#if defined(COMPILING_CONTRACT) || defined(COMPILING_TESTS)
#define PSIBASE_INTRINSIC(x) [[clang::import_name(#x)]]
#else
#define PSIBASE_INTRINSIC(x)
#endif

namespace psibase
{
   // These use mangled names instead of extern "C" to prevent collisions
   // with other libraries. e.g. libc++'s abort_message
   namespace raw
   {
      // Intrinsics which return data do it by storing it in a result buffer.
      // get_result copies min(dest_size, result_size) bytes into dest and returns result_size.
      PSIBASE_INTRINSIC(get_result) uint32_t get_result(const char* dest, uint32_t dest_size);

      // Intrinsics which return keys do it by storing it in a key buffer.
      // get_key copies min(dest_size, key_size) bytes into dest and returns key_size.
      PSIBASE_INTRINSIC(get_key) uint32_t get_key(const char* dest, uint32_t dest_size);

      // Write message to console. Message should be UTF8.
      PSIBASE_INTRINSIC(write_console) void write_console(const char* message, uint32_t len);

      // Abort with message. Message should be UTF8.

#ifndef PSIBASE_ABORT_MESSAGE
      PSIBASE_INTRINSIC(abort_message)
      [[noreturn]] void abort_message(const char* message, uint32_t len);
#endif

      // Store the currently-executing action into result and return the result size.
      //
      // If the contract, while handling action A, calls itself with action B:
      //    * Before the call to B, get_current_action() returns A.
      //    * After the call to B, get_current_action() returns B.
      //    * After B returns, get_current_action() returns A.
      //
      // Note: The above only applies if the contract uses the call() intrinsic.
      //       The call() function and the action wrappers use the call() intrinsic.
      //       Calling a contract function directly does NOT use the call() intrinsic.
      PSIBASE_INTRINSIC(get_current_action) uint32_t get_current_action();

      // Call a contract, store the return value into result, and return the result size.
      PSIBASE_INTRINSIC(call) uint32_t call(const char* action, uint32_t len);

      // Set the return value of the currently-executing action
      PSIBASE_INTRINSIC(set_retval) void set_retval(const char* retval, uint32_t len);

      // Set a key-value pair. If key already exists, then replace the existing value.
      PSIBASE_INTRINSIC(kv_put)
      void kv_put(kv_map      map,
                  const char* key,
                  uint32_t    key_len,
                  const char* value,
                  uint32_t    value_len);

      // Add a sequentially-numbered record. Returns the id.
      PSIBASE_INTRINSIC(kv_put_sequential)
      uint64_t kv_put_sequential(kv_map map, const char* value, uint32_t value_len);

      // Remove a key-value pair if it exists
      PSIBASE_INTRINSIC(kv_remove) void kv_remove(kv_map map, const char* key, uint32_t key_len);

      // Get a key-value pair, if any. If key exists, then sets result to value and
      // returns size. If key does not exist, returns -1 and clears result.
      PSIBASE_INTRINSIC(kv_get) uint32_t kv_get(kv_map map, const char* key, uint32_t key_len);

      // Get a sequentially-numbered record. If id is available, then sets result to value and
      // returns size. If id does not exist, returns -1 and clears result.
      PSIBASE_INTRINSIC(kv_get_sequential) uint32_t kv_get_sequential(kv_map map, uint64_t id);

      // Get the first key-value pair which is greater than or equal to the provided
      // key. If one is found, and the first match_key_size bytes of the found key
      // matches the provided key, then sets result to value and returns size. Also
      // sets key (use get_key). Otherwise returns -1 and clears result.
      PSIBASE_INTRINSIC(kv_greater_equal)
      uint32_t kv_greater_equal(kv_map      map,
                                const char* key,
                                uint32_t    key_len,
                                uint32_t    match_key_size);

      // Get the key-value pair immediately-before provided key. If one is found,
      // and the first match_key_size bytes of the found key matches the provided
      // key, then sets result to value and returns size. Also sets key (use get_key).
      // Otherwise returns -1 and clears result.
      PSIBASE_INTRINSIC(kv_less_than)
      uint32_t kv_less_than(kv_map map, const char* key, uint32_t key_len, uint32_t match_key_size);

      // Get the maximum key-value pair which has key as a prefix. If one is found,
      // then sets result to value and returns size. Also sets key (use get_key).
      // Otherwise returns -1 and clears result.
      PSIBASE_INTRINSIC(kv_max) uint32_t kv_max(kv_map map, const char* key, uint32_t key_len);
   }  // namespace raw

   // Get result when size is known. Caution: this does not verify size.
   std::vector<char> get_result(uint32_t size);

   // Get result when size is unknown
   std::vector<char> get_result();

   // Get key
   std::vector<char> get_key();

   // Abort with message. Message should be UTF8.
   [[noreturn]] inline void abort_message_str(std::string_view msg)
   {
      raw::abort_message(msg.data(), msg.size());
   }

   // Abort with message if !cond. Message should be UTF8.
   inline void check(bool cond, std::string_view message)
   {
      if (!cond)
         abort_message_str(message);
   }

   // Get the currently-executing action.
   //
   // If the contract, while handling action A, calls itself with action B:
   //    * Before the call to B, get_current_action() returns A.
   //    * After the call to B, get_current_action() returns B.
   //    * After B returns, get_current_action() returns A.
   //
   // Note: The above only applies if the contract uses the call() intrinsic.
   //       The call() function and the action wrappers use the call() intrinsic.
   //       Calling a contract function directly does NOT use the call() intrinsic.
   Action                        get_current_action();
   psio::shared_view_ptr<Action> get_current_action_view();

   // Call a contract and return its result
   std::vector<char> call(const char* action, uint32_t len);

   // Call a contract and return its result
   std::vector<char> call(eosio::input_stream action);

   // Call a contract and return its result
   std::vector<char> call(const action& action);

   // Set the return value of the currently-executing action
   template <typename T>
   void set_retval(const T& retval)
   {
      auto data = psio::convert_to_frac(retval);
      raw::set_retval(data.data(), data.size());
   }

   template <typename T>
   void set_frac_retval(const T& retval)
   {
      size_t s = psio::fracpack_size(retval);
      if (false)
      {  //s < 1024 ) {
         char*                  buffer = (char*)alloca(s);
         psio::fixed_buf_stream stream(buffer, s);
         psio::fracpack(retval, stream);
         raw::set_retval(buffer, s);
      }
      else
      {
         std::vector<char>      buffer(s);
         psio::fixed_buf_stream stream(buffer.data(), s);
         psio::fracpack(retval, stream);
         raw::set_retval(buffer.data(), s);
      }
   }

   // Set the return value of the currently-executing action
   inline void set_retval_bytes(eosio::input_stream s)
   {
      raw::set_retval(s.pos, s.remaining());
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   inline void kv_put_raw(kv_map map, eosio::input_stream key, eosio::input_stream value)
   {
      raw::kv_put(map, key.pos, key.remaining(), value.pos, value.remaining());
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   template <typename K, typename V>
   auto kv_put(kv_map map, const K& key, const V& value)
       -> std::enable_if_t<!eosio::is_std_optional<V>(), void>
   {
      kv_put_raw(map, eosio::convert_to_key(key), psio::convert_to_frac(value));
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   template <typename K, typename V>
   auto kv_put(const K& key, const V& value) -> std::enable_if_t<!eosio::is_std_optional<V>(), void>
   {
      kv_put(kv_map::contract, key, value);
   }

   // Add a sequentially-numbered record. Returns the id.
   inline uint64_t kv_put_sequential_raw(kv_map map, eosio::input_stream value)
   {
      return raw::kv_put_sequential(map, value.pos, value.remaining());
   }

   // Add a sequentially-numbered record. Returns the id.
   template <typename Type, typename V>
   auto kv_put_sequential(kv_map        map,
                          AccountNumber contract,
                          Type          type,
                          const V& value) -> std::enable_if_t<!eosio::is_std_optional<V>(), void>
   {
      std::vector<char>     packed(psio::fracpack_size(contract) +
                                   psio::fracpack_size(type) + psio::fracpack_size(value));
      psio::fast_buf_stream stream(packed.data(), packed.size());
      psio::fracpack(contract, stream);
      psio::fracpack(type, stream);
      psio::fracpack(value, stream);
      return kv_put_sequential_raw(map, packed);
   }

   // Remove a key-value pair if it exists
   inline void kv_remove_raw(kv_map map, eosio::input_stream key)
   {
      raw::kv_remove(map, key.pos, key.remaining());
   }

   // Remove a key-value pair if it exists
   template <typename K>
   void kv_remove(kv_map map, const K& key)
   {
      kv_remove_raw(map, eosio::convert_to_key(key));
   }

   // Remove a key-value pair if it exists
   template <typename K>
   void kv_remove(const K& key)
   {
      kv_remove(kv_map::contract, key);
   }

   // Size of key-value pair, if any
   inline std::optional<uint32_t> kv_get_size_raw(kv_map map, eosio::input_stream key)
   {
      auto size = raw::kv_get(map, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return size;
   }

   // Size of key-value pair, if any
   template <typename K>
   inline std::optional<uint32_t> kv_get_size(kv_map map, const K& key)
   {
      return kv_get_size_raw(map, eosio::convert_to_key(key));
   }

   // Size of key-value pair, if any
   template <typename K>
   inline std::optional<uint32_t> kv_get_size(const K& key)
   {
      return kv_get_size(kv_map::contract, key);
   }

   // Get a key-value pair, if any
   inline std::optional<std::vector<char>> kv_get_raw(kv_map map, eosio::input_stream key)
   {
      auto size = raw::kv_get(map, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get a key-value pair, if any
   template <typename V, typename K>
   inline std::optional<V> kv_get(kv_map map, const K& key)
   {
      auto v = kv_get_raw(map, eosio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get a key-value pair, if any
   template <typename V, typename K>
   inline std::optional<V> kv_get(const K& key)
   {
      return kv_get<V>(kv_map::contract, key);
   }

   // Get a value, or the default if not found
   template <typename V, typename K>
   inline V kv_get_or_default(kv_map map, const K& key)
   {
      auto obj = kv_get<V>(map, key);
      if (obj)
         return std::move(*obj);
      return {};
   }

   // Get a value, or the default if not found
   template <typename V, typename K>
   inline V kv_get_or_default(const K& key)
   {
      return kv_get_or_default<V>(kv_map::contract, key);
   }

   // Get a sequentially-numbered record, if available
   inline std::optional<std::vector<char>> kv_get_sequential_raw(kv_map map, uint64_t id)
   {
      auto size = raw::kv_get_sequential(map, id);
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get a sequentially-numbered record, if available.
   // * If matchContract is non-null, and the record wasn't written by matchContract, then return nullopt.
   //   This prevents a spurious abort from mismatched serialization.
   // * If matchType is non-null, and the record type doesn't match, then return nullopt.
   //   This prevents a spurious abort from mismatched serialization.
   // * If blockNum is non-null, then it receives the block number the record was written in. It is
   //   left untouched if the record is not available.
   // * If contract is non-null, then it receives the contract that wrote the record. It is
   //   left untouched if the record is not available.
   // * If type is non-null, then it receives the record type. It is left untouched if either the record
   //   is not available or if matchContract is not null but doesn't match.
   template <typename V, typename Type>
   inline std::optional<V> kv_get_sequential(kv_map               map,
                                             uint64_t             id,
                                             const AccountNumber* matchContract = nullptr,
                                             const Type*          matchType     = nullptr,
                                             BlockNum*            blockNum      = nullptr,
                                             AccountNumber*       contract      = nullptr,
                                             Type*                type          = nullptr)
   {
      std::optional<V> result;
      auto             v = kv_get_sequential_raw(map, id);
      if (!v)
         return result;
      psio::input_stream stream(v->data(), v->size());

      BlockNum      bn;
      AccountNumber c;
      fracunpack(bn, stream);
      fracunpack(c, stream);
      if (blockNum)
         *blockNum = bn;
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
   // returns the value. Also sets key (use get_key). Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_greater_equal_raw(kv_map              map,
                                                                eosio::input_stream key,
                                                                uint32_t            match_key_size)
   {
      auto size = raw::kv_greater_equal(map, key.pos, key.remaining(), match_key_size);
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get the first key-value pair which is greater than or equal to the provided key. If one is
   // found, and the first match_key_size bytes of the found key matches the provided key, then
   // returns the value. Also sets key (use get_key). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_greater_equal(kv_map map, const K& key, uint32_t match_key_size)
   {
      auto v = kv_greater_equal_raw(map, eosio::convert_to_key(key), match_key_size);
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get the first key-value pair which is greater than or equal to the provided key. If one is
   // found, and the first match_key_size bytes of the found key matches the provided key, then
   // returns the value. Also sets key (use get_key). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_greater_equal(const K& key, uint32_t match_key_size)
   {
      return kv_greater_equal<V>(kv_map::contract, key, match_key_size);
   }

   // Get the key-value pair immediately-before provided key. If one is found, and the first
   // match_key_size bytes of the found key matches the provided key, then returns the value.
   // Also sets key (use get_key). Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_less_than_raw(kv_map              map,
                                                            eosio::input_stream key,
                                                            uint32_t            match_key_size)
   {
      auto size = raw::kv_less_than(map, key.pos, key.remaining(), match_key_size);
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get the key-value pair immediately-before provided key. If one is found, and the first
   // match_key_size bytes of the found key matches the provided key, then returns the value.
   // Also sets key (use get_key). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_less_than(kv_map map, const K& key, uint32_t match_key_size)
   {
      auto v = kv_less_than_raw(map, eosio::convert_to_key(key), match_key_size);
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get the key-value pair immediately-before provided key. If one is found, and the first
   // match_key_size bytes of the found key matches the provided key, then returns the value.
   // Also sets key (use get_key). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_less_than(const K& key, uint32_t match_key_size)
   {
      return kv_less_than<V>(kv_map::contract, key, match_key_size);
   }

   // Get the maximum key-value pair which has key as a prefix. If one is found, then returns the
   // value. Also sets key (use get_key). Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_max_raw(kv_map map, eosio::input_stream key)
   {
      auto size = raw::kv_max(map, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get the maximum key-value pair which has key as a prefix. If one is found, then returns the
   // value. Also sets key (use get_key). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_max(kv_map map, const K& key)
   {
      auto v = kv_max_raw(map, eosio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      // TODO: validate (allow opt-in or opt-out)
      return psio::convert_from_frac<V>(*v);
   }

   // Get the maximum key-value pair which has key as a prefix. If one is found, then returns the
   // value. Also sets key (use get_key). Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_max(const K& key)
   {
      return kv_max<V>(kv_map::contract, key);
   }

   inline void write_console(const std::string_view& sv)
   {
      raw::write_console(sv.data(), sv.size());
   }

}  // namespace psibase
