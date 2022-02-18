#pragma once

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
}  // namespace newchain
