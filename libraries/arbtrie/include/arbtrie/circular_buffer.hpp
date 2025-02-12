#include <array>
#include <atomic>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <new>  // Include for std::hardware_destructive_interference_size

template <std::uint64_t buffer_size>
class circular_buffer
{
  private:
   static_assert((buffer_size & (buffer_size - 1)) == 0, "buffer_size must be a power of 2");
   static constexpr std::uint64_t mask = buffer_size - 1;

   class alignas(std::hardware_destructive_interference_size) PushPosition
   {
     public:
      std::atomic<std::uint64_t> position{0};
   };

   std::array<std::uint32_t, buffer_size> buffer;            // The actual data storage
   PushPosition                           push_position;     // Push position, on its own cache line
   std::atomic<std::uint64_t>             read_position{0};  // Read position

  public:
   circular_buffer() = default;

   // Push data into the buffer
   bool push(std::uint32_t data)
   {
      std::uint64_t current_push = push_position.position.load(std::memory_order_relaxed);
      std::uint64_t current_read = read_position.load(std::memory_order_acquire);

      // Check if we are more than buffer_size ahead of the read position
      if (current_push - current_read >= buffer_size)
      {
         return false;  // Buffer overflow detected
      }

      std::uint64_t index = current_push & mask;

      buffer[index] = data;
      push_position.position.store(current_push + 1, std::memory_order_release);
      return true;
   }

   // Read data from the buffer into provided buffer
   std::size_t pop(std::uint32_t* out_buffer, std::size_t max_size)
   {
      std::uint64_t current_read = read_position.load(std::memory_order_relaxed);
      std::uint64_t current_push = push_position.position.load(std::memory_order_acquire);

      if (current_read == current_push)
      {
         return 0;  // No new data to read
      }

      std::uint64_t available = current_push - current_read;  // Safe due to only incrementing push
      std::uint64_t to_read   = std::min(available, static_cast<std::uint64_t>(max_size));

      // Calculate how many items we can read in one contiguous block
      std::uint64_t first_block_size = std::min(to_read, buffer_size - (current_read & mask));

      // Copy the first contiguous block
      std::memcpy(out_buffer, &buffer[current_read & mask],
                  first_block_size * sizeof(std::uint32_t));

      // If there's more to read after wrapping around
      if (first_block_size < to_read)
      {
         // Copy the wrapping part
         std::memcpy(out_buffer + first_block_size, &buffer[0],
                     (to_read - first_block_size) * sizeof(std::uint32_t));
      }

      // Atomically update read position
      read_position.store(current_read + to_read, std::memory_order_relaxed);
      return to_read;
   }
};
