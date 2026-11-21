#!/usr/bin/env python3
"""Public proof and broadcast coordinator. Never loads Bitcoin custody secrets."""
from common import *
import time,fcntl
STATE.mkdir(parents=True,exist_ok=True)
with (STATE/'public-relayer.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 while True:
  try:drive()
  except Exception as error:print('Public relay:',error,flush=True)
  time.sleep(5)
