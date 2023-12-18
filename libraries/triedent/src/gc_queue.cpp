#include <triedent/gc_queue.hpp>

#include <algorithm>

namespace triedent
{
   gc_queue::session::session(gc_queue& q) : _sequence(npos), _queue(&q)
   {
      std::lock_guard l{_queue->_session_mutex};
      _queue->_sessions.push_back(this);
   }
   gc_queue::session::~session()
   {
      std::lock_guard l{_queue->_session_mutex};
      _queue->_sessions.erase(std::find(_queue->_sessions.begin(), _queue->_sessions.end(), this));
   }

   auto gc_queue::make_sequence_order(size_type end)
   {
      return [this, end](size_type sequence) -> size_type
      {
         if (sequence == npos)
         {
            return sequence;
         }
         else if (sequence <= end)
         {
            return sequence + _queue.size();
         }
         else
         {
            return sequence;
         }
      };
   }

   void gc_queue::push(std::shared_ptr<void> element)
   {
      // Destroyed after the mutex is unlocked because the destructor
      // may execute arbitrary code
      std::vector<std::shared_ptr<void>> popped_items;
      std::unique_lock                   l{_queue_mutex};
      auto                               end   = _end.load();
      auto                               start = (end + _queue.size() - _size) % _queue.size();
      // always leave one empty element, to ensure that
      // session._sequence == _end is unambiguous.
      while (_size == _queue.size() - 1)
      {
         auto end_ready = start_wait(start, end);
         if (end_ready == start)
         {
            assert(_waiting);
            _queue_cond.wait(l);
            end   = _end.load();
            start = (end + _queue.size() - _size) % _queue.size();
         }
         else
         {
            pop_some(popped_items, start, end_ready);
            break;
         }
      }
      _queue[end] = std::move(element);
      _end.store(next(end));
      ++_size;
      if (_size == 1)
      {
         _queue_cond.notify_one();
      }
   }

   void gc_queue::poll()
   {
      std::vector<std::shared_ptr<void>> popped_items;
      std::lock_guard                    l{_queue_mutex};
      auto                               end   = _end.load();
      auto                               start = (end + _queue.size() - _size) % _queue.size();
      // _queue.size() is distinct from any sequence that
      // a session can hold (including npos)
      pop_some(popped_items, start, start_wait(_queue.size(), end));
   }

   void gc_queue::flush()
   {
      assert(_sessions.empty());
      std::vector<std::shared_ptr<void>> popped_items;
      std::lock_guard                    l{_queue_mutex};
      auto                               end   = _end.load();
      auto                               start = (end + _queue.size() - _size) % _queue.size();
      pop_some(popped_items, start, end);
   }

   void gc_queue::run(std::atomic<bool>* done)
   {
      std::vector<std::shared_ptr<void>> popped_items;
      std::unique_lock                   l{_queue_mutex};
      while (!done->load())
      {
         _queue_cond.wait(l, [&] { return done->load() || (_size != 0 && !_waiting); });
         auto end   = _end.load();
         auto start = (end + _queue.size() - _size) % _queue.size();
         pop_some(popped_items, start, start_wait(start, end));
         l.unlock();
         popped_items.clear();
         l.lock();
      }
   }

   void gc_queue::notify_run()
   {
      std::lock_guard g{_queue_mutex};
      _queue_cond.notify_all();
   }

   // returns the (circular) index after pos.
   // the result is in [0, _queue.size())
   gc_queue::size_type gc_queue::next(size_type pos)
   {
      ++pos;
      if (pos == _queue.size())
      {
         pos = 0;
      }
      return pos;
   }

   // \pre _queue_mutex is locked
   // \pre start is the beginning of the queue
   // \pre end is the result of a call to wait
   void gc_queue::pop_some(std::vector<std::shared_ptr<void>>& out, size_type start, size_type end)
   {
      for (; start != end; start = next(start))
      {
         if constexpr (debug_gc)
         {
         //   std::osyncstream(std::cout) << "run gc: " << start << std::endl;
         }
         out.push_back(std::move(_queue[start]));
         --_size;
      }
   }

   // \post
   // for each index in [start, R):
   //   either U happens before W or P happens before L
   // \return the sequence of the session with the lowest sequence
   gc_queue::size_type gc_queue::start_wait(size_type start, size_type end)
   {
      std::size_t     lowest_sequence = end;
      auto            order           = make_sequence_order(end);
      std::lock_guard l2{_session_mutex};
      for (const auto& session : _sessions)
      {
         // Let L be a call to lock
         // Let U be the unlock corresponding to L
         // Let P be the push for some resource, that happens before this wait
         //
         // If W sees the value written by L,
         //   - If the value is from a push earlier than P, then then then the element is not popped - okay
         //   - If the value is from P or a later push, then P happens before L (acquire/release) - okay
         // If W sees the value written by U or a later lock or unlock
         //   - U happens before W (acquire/release) - okay
         // If W sees a value written before L
         //   - W is before L in seq_cst (seq_cst load sees the most recent seq_cst store)
         //   - Therefore P happens before L (see lock) - okay
         auto seq = session->_sequence.load() & ~wait_bit;
         if (seq == start)
         {
            if (_waiting)
            {
               return start;
            }
            if (session->_sequence.compare_exchange_strong(seq, start | wait_bit))
            {
               _waiting = true;
               return start;
            }
         }
         if (order(seq) < order(lowest_sequence))
         {
            lowest_sequence = seq;
         }
      }
      return lowest_sequence;
   }
}  // namespace triedent
