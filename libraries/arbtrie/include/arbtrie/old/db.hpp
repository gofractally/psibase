#pragma once
#include <future>
#include <list>
#include <shared_mutex>
#include <triedent/database.hpp>

namespace triedent
{

   struct Status
   {
      bool ok = true;
   };

   /**
    *  This is the high-level interface through which the
    *  database should be accessed if you don't want to maintain
    *  multiple persistent snapshots. This interface is designed to
    *  operate with low-latency syncing between when a write transaction
    *  commits and the first read sees the change.
    */
   class DB
   {
     public:
      struct Options
      {
         bool             create_if_missing = false;
         bool             error_if_exists   = false;
         database::config config;
      };
      typedef std::shared_ptr<root> root_ptr;

      /**
          *  Thread-local read session, used to start read transactions which
          *  all occur from the same state snapshot.
          */
      class ReadSession
      {
        public:
         class Transaction
         {
           public:
            /**
                      *  Span is any type that has a data() and size() method.
                      *      e.g. std::string, std::vector<char>, std::span<const char>
                      */
            template <typename Span>
            Status get(const Span& key, std::vector<char>* value)
            {
               return Status{.ok = _rs._rs->get(_root, {key.data(), key.size()}, value, nullptr)};
            }

            template <typename Span>
            bool get_greater_equal(const Span&        key,
                                   std::vector<char>* result_key,
                                   std::vector<char>* result_val = nullptr)
            {
               return _rs._rs->get_greater_equal(_root, {key.data(), key.size()}, result_key,
                                                 result_val);
            }

            ~Transaction() {}

           private:
            friend class ReadSession;
            Transaction(ReadSession& s) : _rs(s), _root(s._db.getRoot()) {}

            ReadSession& _rs;
            root_ptr     _root;
         };  // Transaction

         //auto startTransaction() { return std::make_shared<Transaction>(std::ref(*this)); }
         auto startTransaction() { return std::shared_ptr<Transaction>(new Transaction(*this)); }

         ReadSession(DB& d) : _db(d) { _rs = _db._db->start_read_session(); }

        private:
         friend class Transaction;

         std::shared_ptr<read_session> _rs;
         DB&                           _db;

      };  // ReadSession

      /**
          * Only one write session can exist and it may only be called by a
          * single thread. Writes are batched in WriteSession::Transactions and
          * can be aborted before any reads see it.
          */
      class WriteSession
      {
        public:
         class Transaction
         {
           public:
            Status get(std::span<const char> key, std::vector<char>& value);
            Status put(std::span<const char> key, std::span<const char> value);
            Status remove(std::span<const char> key);

            Status commit()
            {
               if (_root)
               {
                  //_ws._db._root = _root;
                  _ws.setRoot(std::move(_root));
                  return {};
               }
               return {.ok = false};
            }

            Status abort()
            {
               _root.reset();
               return {};
            }

            ~Transaction() { commit(); }

            // KeySpan and ValueSpan can be any type that has a .data() and .size() method
            // @return the old size if a key was replaced, otherwise 0
            template <typename KeySpan, typename ValueSpan>
            int put(const KeySpan& key, const ValueSpan& value)
            {
               return _ws._ws->upsert(_root, {key.data(), key.size()},
                                      {value.data(), value.size()});
            }

           private:
            friend class WriteSession;
            Transaction(WriteSession& s) : _ws(s), _root(s._db._root) {}

            std::shared_ptr<root> _root;
            WriteSession&         _ws;
         };  // WriteSession::Transaction

         auto startTransaction() { return new Transaction(*this); }

         WriteSession(DB& d) : _db(d)
         {
            _ws       = _db._db->start_write_session();
            _db._root = _ws->get_top_root();
         }

         void validate() { _ws->validate(); }

        private:
         friend class Transaction;
         friend class DB;

         void setRoot(std::shared_ptr<root> r)
         {
            _ws->set_top_root(r);
            _db.setRoot(std::move(r));
         }

         DB&                            _db;
         std::shared_ptr<write_session> _ws;
      };  // WriteSession

      static std::shared_ptr<DB> open(Options opt, std::filesystem::path dir)
      {
         return std::make_shared<DB>(std::make_shared<database>(dir.c_str(), opt.config, database::read_write));
      }

      DB(std::shared_ptr<database> d) : _db(std::move(d)), _ws(*this)
      {
         _root           = _ws._ws->get_top_root();
    //     _release_thread = std::thread([this]() { release_loop(); });
      }

      auto          createReadSession() { return std::make_shared<ReadSession>(std::ref(*this)); }
      WriteSession& writeSession() { return _ws; }

      root_ptr getRoot() const
      {
         root_ptr tmp;
         {
            std::shared_lock m(_root_mutex);
            tmp = _root;
         }
         return tmp;
      }
      ~DB()
      {
         _done = true;
         if( _release_thread.joinable() )
            _release_thread.join();
         _db->print_stats(std::cout, true);
      }

      void print() { _db->print_stats(std::cout, true); }
      bool compact() { return _db->compact_next_segment(); }

     private:  // DB
      void setRoot(root_ptr p)
      {
         root_ptr   tmp = _root;  // delay release until unlock
         {
            std::unique_lock l(_root_mutex);
            _root                = std::move(p);
            //std::unique_lock l2(_release_mutex);
            //_release_queue.push_back(std::move(tmp));
            // TODO: notify release thread
         }
      }

      std::shared_ptr<database> _db;
      WriteSession              _ws;

      void release_loop()
      {
         while (not _done)
         {
            bool rest = false;
            {
               root_ptr tmp;
               {
                  std::unique_lock l(_release_mutex);
                  if (not _release_queue.empty())
                  {
                     tmp = _release_queue.front();
                     _release_queue.pop_front();
                  }
                  else
                  {
                     rest = true;
                  }
               }
            }
            if (rest)
            {
               // TODO: wait conditiopn
               using namespace std::chrono_literals;
               std::this_thread::sleep_for(30ms);
            }
         }
         // clean up
         std::unique_lock l(_root_mutex);
         _release_queue.clear();
      }

      std::atomic<bool>         _done;
      std::thread               _release_thread;
      std::list<root_ptr>       _release_queue;
      mutable std::shared_mutex _root_mutex;
      mutable std::shared_mutex _release_mutex;
      root_ptr                  _root;
   };

}  // namespace triedent
