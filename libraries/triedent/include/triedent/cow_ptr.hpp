#pragma once

#include <atomic>
#include <cassert>
#include <memory>
#include <utility>

namespace triedent
{
   template <typename T>
   class cow_ptr;

   class cow_base
   {
     public:
      cow_base()                = default;
      cow_base(const cow_base&) = delete;

     private:
      template <typename T>
      friend class cow_ptr;
      mutable std::atomic<long> refcount{0};
   };

   // This is a replacement for shared_ptr that is used to hold roots.
   //
   // std::shared_ptr::use_count is not usable in multithreaded environments,
   // for two reasons: it doesn't have a memory barrier, so checking that
   // use_count() == 1 is not sufficient to ensure that all accesses in
   // other threads have completed and it also doesn't include weak_ptrs,
   // so another thread can get a new shared_ptr anyway.
   //
   // This class doesn't have a corresponding weak_ptr and does include
   // the proper memory barriers to make it usable for multi-threaded
   // copy-on-write.
   template <typename T>
   class cow_ptr
   {
     public:
      cow_ptr() : p(nullptr) {}
      cow_ptr(std::nullptr_t) : p(nullptr) {}
      explicit cow_ptr(T* p) : p(p)
      {
         if (p)
         {
            assert(refcount().load(std::memory_order_relaxed) == 0);
            refcount().store(1, std::memory_order_relaxed);
         }
      }
      template <typename... U>
      cow_ptr(std::in_place_t, U&&... u) : cow_ptr(new T(std::forward<U>(u)...))
      {
      }
      cow_ptr(const cow_ptr& other) : p(other.p)
      {
         if (p)
            refcount().fetch_add(1, std::memory_order_acq_rel);
      }
      cow_ptr(cow_ptr&& other) : p(other.p) { other.p = nullptr; }
      cow_ptr& operator=(cow_ptr other)
      {
         swap(*this, other);
         return *this;
      }
      ~cow_ptr()
      {
         if (p && refcount().fetch_sub(1, std::memory_order_acq_rel) == 1)
            delete p;
      }
      T&          operator*() const { return *p; }
      T*          operator->() const { return p; }
      explicit    operator bool() const { return p != nullptr; }
      bool        unique() const { return p && refcount().load(std::memory_order_acquire) == 1; }
      friend void swap(cow_ptr& lhs, cow_ptr& rhs) { std::swap(lhs.p, rhs.p); }
      void        reset() { *this = nullptr; }
      // Returns the old pointer iff it was unique
      std::unique_ptr<T> release()
      {
         if (p && refcount().fetch_sub(1, std::memory_order_acq_rel) == 1)
         {
            std::unique_ptr<T> result(p);
            p = nullptr;
            return result;
         }
         return nullptr;
      }
      friend bool operator==(const cow_ptr& lhs, std::nullptr_t) { return lhs.p == nullptr; }
      friend bool operator==(std::nullptr_t, const cow_ptr& rhs) { return rhs.p == nullptr; }
      friend bool operator==(const cow_ptr& lhs, const cow_ptr& rhs) { return lhs.p == rhs.p; }

     private:
      // \pre p is not null
      std::atomic<long>& refcount() const { return static_cast<const cow_base*>(p)->refcount; }
      T*                 p;
   };

   template <typename T, typename... U>
   cow_ptr<T> make_cow(U&&... u)
   {
      return cow_ptr<T>(std::in_place, std::forward<U>(u)...);
   }
}  // namespace triedent
