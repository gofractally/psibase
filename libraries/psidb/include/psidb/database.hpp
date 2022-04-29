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

     private:
      page_manager _storage;
   };

}  // namespace psidb
