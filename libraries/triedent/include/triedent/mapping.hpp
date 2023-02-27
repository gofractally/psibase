#pragma once

#include <atomic>
#include <filesystem>
#include <utility>
#include <vector>

namespace triedent
{

   enum access_mode
   {
      read_only  = 0,
      read_write = 1
   };

   // Thread safety:
   //
   // The file must not be resized by another process
   //
   // resize, size, and gc may not be called concurrently
   // data may be called concurrently with itself, resize, size, or gc.
   // After calling resize, gc must not be run until all current accesses are complete.
   //
   // More formally,
   //
   // Given
   //   - G is a call to gc
   //   - R is a call to resize such that R happens before G
   //   - D is a call to data
   //   - A is a memory access to the region referenced by the result of D
   // then, the behavior is undefined unless A happens before G OR R happens before D
   //
   class mapping
   {
     public:
      mapping(const std::filesystem::path& file, access_mode mode);
      ~mapping();
      // Sets the size of the file to new_size.  A call to resize
      // should eventually be followed by a call to gc.
      // exception safety: strong
      void resize(std::size_t new_size);
      // Cleans up garbage created by the most recent resize.
      void        gc() noexcept;
      void*       data() { return _data.load(); }
      std::size_t size() const { return _size; }

     private:
      std::atomic<void*>                         _data;
      std::size_t                                _size;
      int                                        _fd;
      access_mode                                _mode;
      std::vector<std::pair<void*, std::size_t>> _old;
   };
}  // namespace triedent
