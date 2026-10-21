import type { Song } from '../sequencer';
import { fanfare } from './fanfare';
import { race1 } from './race1';
import { race2 } from './race2';
import { shop } from './shop';
import { title } from './title';

export const SONGS: Record<string, Song> = { title, race1, race2, fanfare, shop };
export type SongName = keyof typeof SONGS;
