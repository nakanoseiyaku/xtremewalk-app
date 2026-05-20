// Checkpoint definitions with full Date objects using explicit +09:00 timezone
export interface Checkpoint {
  name: string;
  km: number;
  lat: number;
  lng: number;
  cutoff: Date;
  open: Date;
  index: number;
}

// All cutoffs: cp0-cp3 are 2026-05-23, cp4+ are 2026-05-24
export const CHECKPOINTS: Checkpoint[] = [
  {
    index: 0,
    name: 'スタート',
    km: 0,
    lat: 35.249851,
    lng: 139.155874,
    cutoff: new Date('2026-05-23T10:00:00+09:00'),
    open: new Date('2026-05-23T07:00:00+09:00'),
  },
  {
    index: 1,
    name: '第1CP 湘南海岸公園（平塚市）',
    km: 21,
    lat: 35.31769,
    lng: 139.355484,
    cutoff: new Date('2026-05-23T15:30:00+09:00'),
    open: new Date('2026-05-23T10:00:00+09:00'),
  },
  {
    index: 2,
    name: '第2CP 湘南海岸公園水の広場（藤沢市）',
    km: 33,
    lat: 35.31575,
    lng: 139.470528,
    cutoff: new Date('2026-05-23T18:30:00+09:00'),
    open: new Date('2026-05-23T12:00:00+09:00'),
  },
  {
    index: 3,
    name: '第3CP 横浜市児童遊園地（保土ケ谷区）',
    km: 54,
    lat: 35.436109,
    lng: 139.577524,
    cutoff: new Date('2026-05-23T22:30:00+09:00'),
    open: new Date('2026-05-23T15:00:00+09:00'),
  },
  {
    index: 4,
    name: '第4CP ポートサイド公園（横浜市神奈川区）',
    km: 67,
    lat: 35.467196,
    lng: 139.630043,
    cutoff: new Date('2026-05-24T02:00:00+09:00'),
    open: new Date('2026-05-23T17:00:00+09:00'),
  },
  {
    index: 5,
    name: '第5CP 鈴ヶ森道路児童遊園（東京都品川区）',
    km: 86,
    lat: 35.594401,
    lng: 139.736663,
    cutoff: new Date('2026-05-24T08:00:00+09:00'),
    open: new Date('2026-05-23T20:00:00+09:00'),
  },
  {
    index: 6,
    name: 'ゴール livedoorアーバンスポーツパーク（江東区）',
    km: 100,
    lat: 35.6327,
    lng: 139.7875,
    cutoff: new Date('2026-05-24T11:00:00+09:00'),
    open: new Date('2026-05-23T23:00:00+09:00'),
  },
];

// Checkpoint time offsets from race start (in hours). Enables dynamic date calculation.
interface CheckpointOffset {
  index: number;
  name: string;
  km: number;
  lat: number;
  lng: number;
  cutoffHours: number;
  openHours: number;
}

export const CHECKPOINT_OFFSETS: CheckpointOffset[] = [
  { index: 0, name: 'スタート',                                    km: 0,   lat: 35.249851, lng: 139.155874, cutoffHours:  2.5, openHours: -0.5 },
  { index: 1, name: '第1CP 湘南海岸公園（平塚市）',                  km: 21,  lat: 35.31769,  lng: 139.355484, cutoffHours:  8.0, openHours:  2.5 },
  { index: 2, name: '第2CP 湘南海岸公園水の広場（藤沢市）',          km: 33,  lat: 35.31575,  lng: 139.470528, cutoffHours: 11.0, openHours:  4.5 },
  { index: 3, name: '第3CP 横浜市児童遊園地（保土ケ谷区）',          km: 54,  lat: 35.436109, lng: 139.577524, cutoffHours: 15.0, openHours:  7.5 },
  { index: 4, name: '第4CP ポートサイド公園（横浜市神奈川区）',       km: 67,  lat: 35.467196, lng: 139.630043, cutoffHours: 18.5, openHours:  9.5 },
  { index: 5, name: '第5CP 鈴ヶ森道路児童遊園（東京都品川区）',      km: 86,  lat: 35.594401, lng: 139.736663, cutoffHours: 24.5, openHours: 12.5 },
  { index: 6, name: 'ゴール livedoorアーバンスポーツパーク（江東区）', km: 100, lat: 35.6327,   lng: 139.7875,  cutoffHours: 27.5, openHours: 15.5 },
];

export function buildCheckpoints(raceDate: string, startTime: string): Checkpoint[] {
  const raceStart = new Date(`${raceDate}T${startTime}:00+09:00`);
  return CHECKPOINT_OFFSETS.map((o) => ({
    index: o.index,
    name: o.name,
    km: o.km,
    lat: o.lat,
    lng: o.lng,
    cutoff: new Date(raceStart.getTime() + o.cutoffHours * 3_600_000),
    open:   new Date(raceStart.getTime() + o.openHours   * 3_600_000),
  }));
}

export const GOAL_CUTOFF = new Date('2026-05-24T11:00:00+09:00');
export const RACE_START_DATE = '2026-05-23';
