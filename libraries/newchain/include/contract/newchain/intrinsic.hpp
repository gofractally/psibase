#pragma once

#include <eosio/from_bin.hpp>
#include <eosio/to_key.hpp>
#include <newchain/block.hpp>

namespace newchain
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

      // Create an account. This intrinsic is privileged.
      [[clang::import_name("create_account")]] account_num create_account(account_num auth_contract,
                                                                          bool        privileged);
      // Set a contract's code. This intrinsic is privileged.
      [[clang::import_name("set_code")]] void set_code(account_num contract,
                                                       uint8_t     vm_type,
                                                       uint8_t     vm_version,
                                                       const char* code,
                                                       uint32_t    len);

      // Set a key-value pair. If key already exists, then replace the existing value.
      [[clang::import_name("set_kv")]] void set_kv(const char* key,
                                                   uint32_t    key_len,
                                                   const char* value,
                                                   uint32_t    value_len);

      // Get a key-value pair, if any. If key exists, then sets result to value and
      // returns size. If key does not exist, returns -1.
      [[clang::import_name("get_kv")]] uint32_t get_kv(account_num contract,
                                                       const char* key,
                                                       uint32_t    key_len);

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

   // Create an account. This intrinsic is privileged.
   inline account_num create_account(account_num auth_contract, bool privileged)
   {
      return raw::create_account(auth_contract, privileged);
   }

   // Set a contract's code. This intrinsic is privileged.
   inline void set_code(account_num         contract,
                        uint8_t             vm_type,
                        uint8_t             vm_version,
                        eosio::input_stream code)
   {
      raw::set_code(contract, vm_type, vm_version, code.pos, code.remaining());
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   inline void set_kv_bytes(eosio::input_stream key, eosio::input_stream value)
   {
      raw::set_kv(key.pos, key.remaining(), value.pos, value.remaining());
   }

   // Set a key-value pair. If key already exists, then replace the existing value.
   template <typename K, typename V>
   void set_kv(const K& key, const V& value)
   {
      set_kv_bytes(eosio::convert_to_key(key), eosio::convert_to_bin(value));
   }

   // Get a key-value pair, if any
   inline std::optional<std::vector<char>> get_kv_bytes(account_num         contract,
                                                        eosio::input_stream key)
   {
      auto size = raw::get_kv(contract, key.pos, key.remaining());
      if (size == -1)
         return std::nullopt;
      return get_result(size);
   }

   // Get a key-value pair, if any
   template <typename V, typename K>
   inline std::optional<V> get_kv(account_num contract, const K& key)
   {
      auto v = get_kv_bytes(contract, eosio::convert_to_key(key));
      if (!v)
         return std::nullopt;
      return eosio::convert_from_bin<V>(*v);
   }
}  // namespace newchain
