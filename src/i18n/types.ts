import type { ErrorParams, LogEntry, PlayerId } from '../lib/engine/engine';
import type { GoldfishLogEntry, Zone } from '../lib/goldfish';
import type { ErrorCode } from '../lib/multiplayer/protocol';

/** Errors produced in the browser itself (not by the engine or server). */
export type ClientErrorCode =
  | 'notConnected' | 'enterYourName' | 'enterRoomCode' | 'deckTooSmall' | 'decksTooSmall' | 'loadFailed'
  | 'cannotCastNow' | 'nothingToTarget' | 'chooseTargetKind';

export interface AppError {
  code: ErrorCode | ClientErrorCode;
  params?: ErrorParams;
}

export interface LogContext {
  name: (p: PlayerId) => string;
  isMe: (p: PlayerId) => boolean;
  /** "A, B and C" in the current language. */
  list: (items: string[]) => string;
  /** Card name in the current language (logs store English names). */
  card: (englishName: string) => string;
}

type Entry<K> = Extract<LogEntry, { k: K }>;
export type LogMessages = { [K in LogEntry['k']]: (e: Entry<K>, c: LogContext) => string };

type GEntry<K> = Extract<GoldfishLogEntry, { k: K }>;
export type GoldfishLogMessages = {
  [K in GoldfishLogEntry['k']]: (e: GEntry<K>, zone: (z: Zone) => string, card: (englishName: string) => string) => string;
};

export type ErrorMessages = Record<ErrorCode | ClientErrorCode, (p: ErrorParams) => string>;
