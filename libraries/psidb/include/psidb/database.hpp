#pragma once

#include <psidb/page_manager.hpp>
#include <psidb/transaction.hpp>

namespace psidb
{

   class database
   {
     public:
      /**
       * Takes ownership of fd.  fd must be a read/write descriptor for a regular file.
       */
      database(int fd, std::size_t memory_pages) : _storage(fd, memory_pages) {}
      database(const char* filename, std::size_t memory_pages) : _storage(filename, memory_pages) {}
      database(const std::string& filename, std::size_t memory_pages)
          : _storage(filename.c_str(), memory_pages)
      {
      }
      transaction start_transaction()
      {
         return {&_storage, _storage.start_transaction(), _storage.flush_version()};
      }
      // clone_version is irrevelent if we never write.
      transaction start_read() { return {&_storage, _storage.get_head(), 0}; }
      auto        stable_checkpoints() const { return _storage.get_stable_checkpoints(); }
      void delete_stable_checkpoint(const checkpoint& c) { _storage.delete_stable_checkpoint(c); }
      void async_flush(bool stable = true) { _storage.async_flush(stable); }
      void sync() { _storage.sync(); }
      auto get_stats() const { return _storage.get_stats(); }
      std::size_t checkpoints() const { return _storage.checkpoints(); }

      void full_gc() { _storage.run_gc(); }
      void run_gc_loop() { _storage.run_gc_loop(); }
      void stop_gc() { _storage.stop_gc(); }
      void print_summary() { _storage.print_summary(); }

     private:
      page_manager _storage;
   };

}  // namespace psidb
