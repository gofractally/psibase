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
      transaction start_transaction() { return {&_storage, _storage.start_transaction()}; }
      transaction start_read() { return {&_storage, _storage.get_head()}; }
      void        async_flush(bool stable = true) { _storage.async_flush(stable); }
      auto        get_stats() const { return _storage.get_stats(); }
      std::size_t checkpoints() const { return _storage.checkpoints(); }
      void        print_summary() { _storage.print_summary(); }

     private:
      page_manager _storage;
   };

}  // namespace psidb
