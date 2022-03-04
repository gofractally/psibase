#pragma once

#include <eosio/from_bin.hpp>
#include <eosio/to_key.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   // These use mangled names instead of extern "C" to prevent collisions
   // with other libraries. e.g. libc++'s abort_message
   namespace raw
   {
      // Intrinsics which return data do it by storing it in a result buffer.
      // get_result copies min(dest_size, result_size) bytes into dest and returns result_size.
      [[clang::import_name("get_result")]] uint32_t get_result(const char* dest,
                                                               uint32_t    dest_size);

      // Write message to console. Message should be UTF8.
      [[clang::import_name("write_console")]] void write_console(const char* message, uint32_t len);

      // Abort with message. Message should be UTF8.
      [[clang::import_name("abort_message"), noreturn]] void abort_message(const char* message,
                                                                           uint32_t    len);

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
      [[clang::import_name("get_current_action")]] uint32_t get_current_action();

      // Call a contract, store the return value into result, and return the result size.
      [[clang::import_name("call")]] uint32_t call(const char* action, uint32_t len);

      // Set the return value of the currently-executing action
      [[clang::import_name("set_retval")]] void set_retval(const char* retval, uint32_t len);

      // Set a key-value pair. If key already exists, then replace the existing value.
      [[clang::import_name("kv_put")]] void kv_put(kv_map      map,
                                                   const char* key,
                                                   uint32_t    key_len,
                                                   const char* value,
                                                   uint32_t    value_len);

      // Remove a key-value pair if it exists
      [[clang::import_name("kv_remove")]] void kv_remove(kv_map      map,
                                                         const char* key,
                                                         uint32_t    key_len);

      // Get a key-value pair, if any. If key exists, then sets result to value and
      // returns size. If key does not exist, returns -1 and clears result.
      [[clang::import_name("kv_get")]] uint32_t kv_get(kv_map      map,
                                                       const char* key,
                                                       uint32_t    key_len);

      // Get a key-value pair immediately-before provided key. If one is found,
      // and the first match_key_size bytes of the found key matches the provided
      // key, then sets result to value and returns size. Otherwise returns -1
      // and clears result.
      [[clang::import_name("kv_less_than")]] uint32_t kv_less_than(kv_map      map,
                                                                   const char* key,
                                                                   uint32_t    key_len,
                                                                   uint32_t    match_key_size);

   }  // namespace raw

   // Get result when size is known. Caution: this does not verify size.
   std::vector<char> get_result(uint32_t size);

   // Get result when size is unknown
   std::vector<char> get_result();

   // Abort with message. Message should be UTF8.
   [[noreturn]] inline void abort_message(std::string_view msg)
   {
      raw::abort_message(msg.data(), msg.size());
   }

   // Abort with message if !cond. Message should be UTF8.
   inline void check(bool cond, std::string_view message)
   {
      if (!cond)
         abort_message(message);
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
   action get_current_action();

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
      auto data = eosio::convert_to_bin(retval);
      raw::set_retval(data.data(), data.size());
   }

   // Set the return value of the currently-executing action
   inline void set_retval_bytes(eosio::input_stream s) { raw::set_retval(s.pos, s.remaining()); }

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
      kv_put_raw(map, eosio::convert_to_key(key), eosio::convert_to_bin(value));
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   template <typename K, typename V>
   auto kv_put(const K& key, const V& value) -> std::enable_if_t<!eosio::is_std_optional<V>(), void>
   {
      kv_put(kv_map::contract, key, value);
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
      return eosio::convert_from_bin<V>(*v);
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

   // Get a key-value pair immediately-before provided key. If one is found,
   // and the first match_key_size bytes of the found key matches the provided
   // key, then sets result to value and returns size. Otherwise returns nullopt.
   inline std::optional<std::vector<char>> kv_less_than_raw(kv_map              map,
                                                            eosio::input_stream key,
                                                            uint32_t            match_key_size)
   {
      auto size = raw::kv_less_than(map, key.pos, key.remaining(), match_key_size);
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get a key-value pair immediately-before provided key. If one is found,
   // and the first match_key_size bytes of the found key matches the provided
   // key, then sets result to value and returns size. Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_less_than(kv_map map, const K& key, uint32_t match_key_size)
   {
      auto v = kv_less_than_raw(map, eosio::convert_to_key(key), match_key_size);
      if (!v)
         return std::nullopt;
      return eosio::convert_from_bin<V>(*v);
   }

   // Get a key-value pair immediately-before provided key. If one is found,
   // and the first match_key_size bytes of the found key matches the provided
   // key, then sets result to value and returns size. Otherwise returns nullopt.
   template <typename V, typename K>
   inline std::optional<V> kv_less_than(const K& key, uint32_t match_key_size)
   {
      return kv_less_than<V>(kv_map::contract, key, match_key_size);
   }

}  // namespace psibase
