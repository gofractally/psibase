#pragma once

#include <psibase/BucketSet.hpp>
#include <psibase/ExecutionContext.hpp>

#include <eosio/vm/argument_proxy.hpp>
#include <eosio/vm/span.hpp>
#include <psibase/nativeTables.hpp>

namespace psibase
{
   struct NativeFunctions
   {
      Database&           database;
      TransactionContext& transactionContext;
      const DbMode&       dbMode;
      CodeRow             code               = {};
      ActionContext*      currentActContext  = nullptr;  // Changes during recursion
      ExecutionContext*   currentExecContext = nullptr;

      std::vector<char> result_key;
      std::vector<char> result_value;

      BucketSet buckets;

      // TODO: delete range. Need some way for system services to enable/disable it
      //       since it's only compatible with some resource models
      // TODO: some way for Transact to indicate auth failures.
      //       Maybe not an intrinsic? Is there a way to tie this into the
      //       subjective mechanics?
      // TODO: related to ^. Some way to bill failed transactions after the first
      //       authorizer has been verified. But... custom proof and auth services
      //       could abuse that. Maybe a time limit for the proofs and the first auth
      //       service? Can't limit just a single proof since first auth could depend
      //       on several proofs.
      // TODO: related to ^. See TODOs on NativeFunctions::call

      uint32_t getResult(eosio::vm::span<char> dest, uint32_t offset);
      uint32_t getKey(eosio::vm::span<char> dest);
      void     writeConsole(eosio::vm::span<const char> str);
      void     abortMessage(eosio::vm::span<const char> str);
      int32_t  clockTimeGet(uint32_t id, eosio::vm::argument_proxy<uint64_t*> time);
      void     getRandom(eosio::vm::span<char> dest);
      void     setMaxTransactionTime(uint64_t nanoseconds);
      uint32_t getCurrentAction();
      uint32_t call(eosio::vm::span<const char> data, std::uint64_t flags);
      void     setRetval(eosio::vm::span<const char> data);
      uint32_t kvOpen(uint32_t db, eosio::vm::span<const char> prefix, uint32_t mode);
      uint32_t kvOpenAt(uint32_t handle, eosio::vm::span<const char> prefix, uint32_t mode);
      void     kvClose(uint32_t handle);
      void     exportHandles(eosio::vm::span<const char> data);
      uint32_t importHandles();
      void     kvPut(uint32_t                    handle,
                     eosio::vm::span<const char> key,
                     eosio::vm::span<const char> value);
      uint64_t putSequential(uint32_t db, eosio::vm::span<const char> value);
      void     kvRemove(uint32_t handle, eosio::vm::span<const char> key);
      uint32_t kvGet(uint32_t handle, eosio::vm::span<const char> key);
      uint32_t getSequential(uint32_t db, uint64_t indexNumber);
      uint32_t kvGreaterEqual(uint32_t                    handle,
                              eosio::vm::span<const char> key,
                              uint32_t                    matchKeySize);
      uint32_t kvLessThan(uint32_t handle, eosio::vm::span<const char> key, uint32_t matchKeySize);
      uint32_t kvMax(uint32_t handle, eosio::vm::span<const char> key);
      uint32_t kvGetTransactionUsage();

      void checkoutSubjective();
      bool commitSubjective();
      void abortSubjective();

      int32_t socketOpen(eosio::vm::span<const char> args);
      int32_t socketSend(int32_t fd, eosio::vm::span<const char> msg);
      int32_t socketAutoClose(int32_t fd, bool value);
   };  // NativeFunctions
}  // namespace psibase
