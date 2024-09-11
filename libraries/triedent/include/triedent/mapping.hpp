#pragma once

#include <atomic>
#include <filesystem>
#include <memory>
#include <utility>

namespace triedent
{

   enum access_mode
   {
      read_only  = 0,
      read_write = 1,
   };

   enum class open_mode
   {
      // Open an existing database
      read_only  = 0,
      read_write = 1,
      // Create a new database if the database does not exist
      create = 2,
      // Create a new database, overwriting an existing database
      trunc = 3,
      // Create a new database. It is an error if the database already exists
      create_new = 4,
      // Create a unique temporary database which will be deleted when it is closed.
      // The path should be an existing directory.
      temporary = 5,
      // Open an existing database for garbage collection
      gc = 6,
   };

   // Thread safety:
   //
   // The file must not be resized by another process
   //
   // resize and size may not be called concurrently
   // data may be called concurrently with itself, resize, or size
   // The pointer returned by resize must be retained until all accesses to the previous data complete.
   //
   // Formally,
   //
   // Given
   //   - R is a call to resize that returns a non-null pointer
   //   - X is the destruction of the last copy of the result of R
   //   - D is a call to data
   //   - A is a memory access to the region referenced by the result of D
   // then, the behavior is undefined unless A happens before X OR R happens before D
   //
   class mapping
   {
     public:
      mapping(const std::filesystem::path& file, open_mode mode, bool pin = false);
      ~mapping();
      // Sets the size of the file to new_size.
      //
      // If data is invalidated, returns a shared_ptr that owns the
      // previous data. Otherwise returns null.
      //
      // exception safety: strong
      std::shared_ptr<void> resize(std::size_t new_size);
      void*                 data() { return _data.load(); }
      const void*           data() const { return _data.load(); }
      std::size_t           size() const { return _size; }
      bool                  pinned() const { return _pinned; }
      access_mode           mode() const { return _mode; }

     private:
      std::atomic<void*> _data;
      std::size_t        _size;
      int                _fd;
      access_mode        _mode;
      bool               _pinned;
   };
}  // namespace triedent
