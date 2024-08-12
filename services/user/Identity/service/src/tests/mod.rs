/* Test Suite Summary:
 - new attestatations are posted to tables properly, including summary stats
 - queries return expected data
  - empty query responses
 - bad input args to actions and queries produce reasonable error responses
 - queries for non-existent records produce reasonable error responses
*/
mod attestations;
mod errors; // updated
mod queries; // updated
mod stats;
mod test_helpers;
