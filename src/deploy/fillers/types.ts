/**
 * Shared types for block filler modules.
 */
import type { NocoBaseClient } from '../../client';
import type { BlockSpec } from '../../types/spec';
import type { BlockState } from '../../types/state';

export type LogFn = (msg: string) => void;

export interface PopupContext {
  refDepth: number;        // remaining reference-expansion budget (decrements on each ref expansion)
  seenColls: Set<string>;  // circular reference detection (stops infinite popup chains)
}

/** Common params passed to most filler functions. */
export interface FillerContext {
  nb: NocoBaseClient;
  blockUid: string;
  gridUid: string;
  bs: BlockSpec;
  coll: string;
  modDir: string;
  blockState: BlockState;
  allBlocksState: Record<string, BlockState>;
  pageGridUid: string;
  log: LogFn;
  popupContext: PopupContext;
}
