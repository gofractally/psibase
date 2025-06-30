#pragma once

#include <triedent/file_fwd.hpp>

#include <atomic>
#include <filesystem>
#include <memory>
#include <utility>

namespace triedent
{

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

      // Sets the size of the file to new_size.
      //
      // Not thread-safe
      void unsafe_resize(std::size_t new_size);

     private:
      std::atomic<void*> _data;
      std::size_t        _size;
      int                _fd;
      access_mode        _mode;
      bool               _pinned;
   };
}  // namespace triedent
