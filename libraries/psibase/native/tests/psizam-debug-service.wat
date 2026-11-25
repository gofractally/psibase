;; A service for the service-debugging tests (ServiceDebugTests.cpp). Its
;; functions are named, and the tests look for those names in backtraces and in
;; the image handed to a debugger, so assemble it with the names kept:
;;   wat2wasm --debug-names psizam-debug-service.wat -o psizam-debug-service.wasm
;;
;; What a call does is chosen by the action it runs: the byte after "####" in
;; the action's bytes is the mode, and the byte after that an argument. An
;; action without the marker does nothing, successfully. Every mode is reached
;; through $debug_outer -> $debug_middle -> $debug_inner.
(module
  (type $none (func))
  (type $number (func (param i64)))
  (import "env" "getCurrentAction" (func $getCurrentAction (result i32)))
  (import "env" "getResult" (func $getResult (param i32 i32 i32) (result i32)))
  (import "env" "call" (func $call (param i32 i32 i64) (result i32)))
  (import "env" "abortMessage" (func $abortMessage (param i32 i32)))
  (import "env" "writeConsole" (func $writeConsole (param i32 i32)))
  (import "env" "setRetval" (func $setRetval (param i32 i32)))
  (import "env" "kvOpen" (func $kvOpen (param i32 i32 i32 i32) (result i32)))
  (import "env" "kvPut" (func $kvPut (param i32 i32 i32 i32 i32)))
  (memory 1)
  ;; Entry 0 stays null; entry 1 has type $none.
  (table 2 funcref)
  (elem (i32.const 1) $debug_spin)
  (data (i32.const 64) "debug fixture abort")
  (data (i32.const 96) "debug fixture ran")
  ;; The key written by mode 1; its last byte is replaced by the argument.
  (data (i32.const 120) "debug-k?")
  ;; A length and an Action for the peer service, written in by the test.
  (data (i32.const 128) "DEBUG_PEER_ABORT_ACTION\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00")
  (data (i32.const 256) "DEBUG_PEER_WRITE_ACTION\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00")
  (global $mode (mut i32) (i32.const 0))
  (global $argument (mut i32) (i32.const 0))

  ;; Copies the current action to 1024 and finds the marker in it.
  (func $read_action (local $size i32) (local $at i32)
    ;; The node calls back into a running service (a write is reported to the
    ;; transaction service), so a mode must not outlive its action.
    i32.const 0 global.set $mode
    call $getCurrentAction
    local.set $size
    local.get $size i32.const 60000 i32.gt_u
    if return end
    i32.const 1024 local.get $size i32.const 0 call $getResult drop
    block $done
      loop $scan
        local.get $at i32.const 6 i32.add local.get $size i32.gt_u
        br_if $done
        local.get $at i32.const 1024 i32.add i32.load align=1
        i32.const 0x23232323 i32.eq
        if
          local.get $at i32.const 1028 i32.add i32.load8_u global.set $mode
          local.get $at i32.const 1029 i32.add i32.load8_u global.set $argument
          return
        end
        local.get $at i32.const 1 i32.add local.set $at
        br $scan
      end
    end)

  (func $debug_recurse (param $depth i64) (result i64)
    local.get $depth i64.const 1 i64.add call $debug_recurse
    i64.const 1 i64.add)

  (func $debug_spin
    (loop $forever br $forever))

  (func $debug_write (local $handle i32)
    i32.const 127 global.get $argument i32.store8
    ;; DbId::service, no prefix, KvMode::readWrite
    i32.const 0 i32.const 0 i32.const 0 i32.const 3 call $kvOpen
    local.set $handle
    i32.const 2048 global.get $argument i32.store
    local.get $handle i32.const 120 i32.const 8 i32.const 2048 i32.const 4 call $kvPut
    i32.const 96 i32.const 17 call $writeConsole
    i32.const 2048 i32.const 4 call $setRetval)

  (func $debug_inner
    global.get $mode i32.const 1 i32.eq
    if call $debug_write return end
    global.get $mode i32.const 2 i32.eq
    if unreachable end
    global.get $mode i32.const 3 i32.eq
    if i32.const 64 i32.const 19 call $abortMessage return end
    global.get $mode i32.const 4 i32.eq
    if i64.const 0 call $debug_recurse drop return end
    global.get $mode i32.const 5 i32.eq
    if call $debug_spin return end
    global.get $mode i32.const 6 i32.eq
    if i32.const 1 i32.const 0 i32.div_u drop return end
    global.get $mode i32.const 7 i32.eq
    if i32.const 0x80000000 i32.const -1 i32.div_s drop return end
    global.get $mode i32.const 8 i32.eq
    if i32.const 0xfffffff0 i32.load drop return end
    global.get $mode i32.const 9 i32.eq
    if f32.const nan i32.trunc_f32_s drop return end
    global.get $mode i32.const 10 i32.eq
    if i32.const 0 call_indirect (type $none) return end
    global.get $mode i32.const 11 i32.eq
    if i32.const 7 call_indirect (type $none) return end
    global.get $mode i32.const 12 i32.eq
    if i64.const 0 i32.const 1 call_indirect (type $number) return end
    global.get $mode i32.const 13 i32.eq
    if i32.const 132 i32.const 128 i32.load i64.const 0 call $call drop return end
    global.get $mode i32.const 14 i32.eq
    if
      i32.const 260 i32.const 256 i32.load i64.const 0 call $call drop
      call $debug_write
      return
    end)

  (func $debug_middle
    call $debug_inner)

  (func $debug_outer
    call $read_action
    call $debug_middle)

  (func (export "start") (param i64))
  (func $processTransaction (export "processTransaction")
    call $debug_outer)
  (func $called (export "called") (param $service i64) (param $sender i64)
    call $debug_outer))
