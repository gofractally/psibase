#pragma once

#include <array>
#include <atomic>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <new>  // Include for std::hardware_destructive_interference_size

/**
 * @brief A lock-free single-producer single-consumer circular buffer implementation
 * 
 * This class implements a fixed-size circular buffer that allows concurrent access from one producer 
 * and one consumer thread without requiring explicit locks. It uses atomic operations and cache line 
 * padding to provide efficient thread-safe communication.
 *
 * The buffer size must be a power of 2 to allow efficient wrapping using bitwise operations.
 * By default, the buffer stores 32-bit unsigned integers, but can store any type T.
 *
 * Key features:
 * - Lock-free implementation using atomic operations
 * - Cache line padding to prevent false sharing
 * - Fixed size buffer with power-of-2 size requirement
 * - Single producer / single consumer design
 * - Non-blocking push and pop operations
 *
 * Usage:
 * The producer thread calls push() to add data while the consumer thread calls pop() to retrieve data.
 * If the buffer is full, push() will return false. If the buffer is empty, pop() will return 0.
 *
 * This buffer is used within the arbtrie library for efficient inter-thread communication, particularly
 * for passing read node IDs from read threads to the compact thread so that they can be moved to
 * the pinned RAM cache.
 *
 * @tparam T The type of elements stored in the buffer, defaults to uint32_t
 * @tparam buffer_size The size of the circular buffer, must be a power of 2
 */
template <typename T, uint64_t buffer_size>
class circular_buffer
{
  private:
   static_assert((buffer_size & (buffer_size - 1)) == 0, "buffer_size must be a power of 2");
   static constexpr uint64_t mask = buffer_size - 1;

   class alignas(std::hardware_destructive_interference_size) PushPosition
   {
     public:
      std::atomic<uint64_t> position{0};
   };

   std::array<T, buffer_size> buf;          // The actual data storage
   PushPosition               push_pos;     // Push position, on its own cache line
   std::atomic<uint64_t>      read_pos{0};  // Read position

  public:
   circular_buffer() = default;

   // Push data into the buffer, only one thread can push at a time
   bool push(T data)
   {
      uint64_t current_push = push_pos.position.load(std::memory_order_relaxed);
      uint64_t current_read = read_pos.load(std::memory_order_acquire);

      // Check if we are more than buffer_size ahead of the read position
      if (current_push - current_read >= buffer_size)
      {
         return false;  // Buffer overflow detected
      }

      uint64_t index = current_push & mask;

      buf[index] = data;
      push_pos.position.store(current_push + 1, std::memory_order_release);
      return true;
   }

   // Pop a single element from the buffer
   bool pop(T& out_data)
   {
      uint64_t current_read = read_pos.load(std::memory_order_relaxed);
      uint64_t current_push = push_pos.position.load(std::memory_order_acquire);

      if (current_read == current_push)
      {
         return false;  // No data available
      }

      out_data = buf[current_read & mask];
      read_pos.store(current_read + 1, std::memory_order_relaxed);
      return true;
   }

   // Read data from the buffer into provided buffer
   std::size_t pop(T* out_buffer, std::size_t max_size)
   {
      uint64_t current_read = read_pos.load(std::memory_order_relaxed);
      uint64_t current_push = push_pos.position.load(std::memory_order_acquire);

      if (current_read == current_push)
      {
         return 0;  // No new data to read
      }

      uint64_t available = current_push - current_read;  // Safe due to only incrementing push
      uint64_t to_read   = std::min(available, static_cast<uint64_t>(max_size));

      // Calculate how many items we can read in one contiguous block
      uint64_t first_block_size = std::min(to_read, buffer_size - (current_read & mask));

      // Copy the first contiguous block
      std::memcpy(out_buffer, &buf[current_read & mask], first_block_size * sizeof(T));

      // If there's more to read after wrapping around
      if (first_block_size < to_read)
      {
         // Copy the wrapping part
         std::memcpy(out_buffer + first_block_size, &buf[0],
                     (to_read - first_block_size) * sizeof(T));
      }

      // Atomically update read position
      read_pos.store(current_read + to_read, std::memory_order_relaxed);
      return to_read;
   }
};
