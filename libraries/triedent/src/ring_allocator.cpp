#include <triedent/ring_allocator.hpp>

#include <triedent/debug.hpp>

namespace triedent
{
   ring_allocator::ring_allocator(const std::filesystem::path& path,
                                  std::uint64_t                size,
                                  std::uint8_t                 level,
                                  access_mode                  mode,
                                  bool                         pin)
       : _file(path, mode, pin), _level(level), _free_min(0)
   {
      if (_file.size() == 0)
      {
         _file.resize(round_to_page(sizeof(header) + size));
         new (_file.data()) header{.magic   = file_magic,
                                   .flags   = (level << 8) | file_type_data,
                                   .start   = sizeof(header),
                                   .size    = size,
                                   .alloc_p = 0,
                                   .swap_p  = 0};
      }
      _header = reinterpret_cast<header*>(_file.data());

      if (_header->magic != file_magic)
         throw std::runtime_error("Not a triedent file: " + path.native());
      if ((_header->flags & file_type_mask) != file_type_data)
         throw std::runtime_error("Not a triedent data file: " + path.native());
      if ((_header->flags >> 8) != level)
         throw std::runtime_error("Unexpected level in data file: " + path.native());
      if (_header->start.load() + _header->size.load() > _file.size())
         throw std::runtime_error("File size is smaller than required by the header: " +
                                  path.native());

      _base       = reinterpret_cast<char*>(_header) + _header->start.load();
      _end_free_p = _header->swap_p.load() ^ (_mask + 1);
   }

   void ring_allocator::wait_swap(std::uint64_t min_bytes, std::atomic<bool>* done)
   {
      std::unique_lock l{_free_mutex};
      _free_min = min_bytes;
      _swap_cond.wait(l,
                      [&] { return done->load() || potential_free_bytes_unlocked() < min_bytes; });
      _free_min = 0;
   }

   void ring_allocator::notify_swap()
   {
      // The lock here is needed to synchronize-with wait_swap
      // even through no data is accessed while holding the lock.
      std::lock_guard g{_free_mutex};
      _swap_cond.notify_all();
   }

   std::shared_ptr<void> ring_allocator::make_update_free(std::uint64_t bytes)
   {
      if (bytes == 0)
      {
         return nullptr;
      }
      // Adding a delta to end_free_p is simpler than trying to track
      // the high water mark. If the updates are processed out of
      // order, it results in slightly weird behavior (end_free_p
      // may not point to an object_header boundary), but still works
      // because addition is commutative and we only care that end_free_p
      // is before any object that is still being accessed.
      struct update_free
      {
         ~update_free()
         {
            {
               std::lock_guard l{_self->_free_mutex};
               auto [end_free_p, end_free_x] = split_p(_self->_end_free_p);
               auto size                     = _self->_header->size.load();
               end_free_p += _bytes;
               if (end_free_p >= size)
               {
                  end_free_p -= size;
                  end_free_x ^= (_mask + 1);
               }
               _self->_end_free_p = end_free_p | end_free_x;
               if constexpr (debug_gc)
               {
             //     std::osyncstream(std::cout)
             //         << "end_free_p: " << _self->_level << ":" << end_free_p << std::endl;
               }
            }
            _self->_free_cond.notify_all();
         }
         ring_allocator* _self;
         std::uint64_t   _bytes;
      };
      return std::make_shared<update_free>(this, bytes);
   }

}  // namespace triedent
