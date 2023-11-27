#pragma once
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
         bool create_if_missing = false;
         bool error_if_exists   = false;
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
            bool get_greater_equal( const Span& key, std::vector<char>* result_key, std::vector<char>* result_val = nullptr ) {
               return _rs._rs->get_greater_equal( _root, {key.data(), key.size()}, result_key, result_val );
            }

           private:
            friend class ReadSession;
            Transaction(ReadSession& s) : _rs(s), _root(s._db._root) {}


            ReadSession& _rs;
            root_ptr     _root;
         };  // Transaction

         //auto startTransaction() { return std::make_shared<Transaction>(std::ref(*this)); }
         auto startTransaction() { return new Transaction(*this); }

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
                  _ws._db._root = _root;
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

        private:
         friend class Transaction;
         friend class DB;

         void setRoot(std::shared_ptr<root> r)
         {
            _ws->set_top_root(r);
            _db._root = std::move(r);
         }

         DB&                            _db;
         std::shared_ptr<write_session> _ws;
      };  // WriteSession

      static std::shared_ptr<DB> open(Options opt, std::filesystem::path dir)
      {
         return std::make_shared<DB>(std::make_shared<database>(dir.c_str(), database::read_write));
      }

      DB(std::shared_ptr<database> d) : _db(std::move(d)),_ws(*this)
      {
         _root = _ws._ws->get_top_root();
      }

      auto createReadSession() { return std::make_shared<ReadSession>(std::ref(*this)); }
      WriteSession& writeSession() { return _ws; }

     private:  // DB
      friend class WriteSession;
      friend class ReadSession;

      void setRoot(std::shared_ptr<root> r) { _root = r; }

      std::shared_ptr<database>     _db;
      WriteSession                  _ws;
      root_ptr                      _root;
   };

}  // namespace triedent
