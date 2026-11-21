#!/usr/bin/env python3
"""Prepare a reviewable proof-carrying Psibase action; does not submit it."""
from pathlib import Path
import argparse,json,subprocess
ROOT=Path(__file__).resolve().parents[2]
def main():
 p=argparse.ArgumentParser();p.add_argument('witness',type=Path);p.add_argument('--relayer',type=Path,required=True);p.add_argument('--sender',required=True);p.add_argument('--action',choices=['update','deposit','complete','backfill'],required=True);p.add_argument('--block');p.add_argument('--batch',type=int);p.add_argument('--child');p.add_argument('--out',type=Path,required=True);args=p.parse_args()
 witness=json.loads(args.witness.read_text());checked=json.loads(subprocess.check_output([str(args.relayer),'inspect',str(args.witness)],text=True));data={'fact_json':json.dumps(checked['fact'],separators=(',',':'))};service='ethrelay' if args.action in ('update','backfill') else 'ethbridge'
 if args.action in ('deposit','complete'):
  if not args.block:p.error('--block is required for receipt evidence')
  data['block']=args.block.removeprefix('0x').lower()
 if args.action=='complete':
  if args.batch is None or args.batch<0:p.error('--batch must be nonnegative')
  data['batch']=args.batch
 if args.action=='backfill':
  if not args.child:p.error('--child is required')
  data['child']=args.child.removeprefix('0x').lower()
 args.out.write_text(json.dumps({'actions':[{'sender':args.sender,'service':service,'method':args.action,'data':data}],'witnesses':[witness]},indent=2)+'\n');print('Prepared',args.out)
if __name__=='__main__':main()
