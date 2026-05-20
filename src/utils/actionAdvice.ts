export interface ActionAdvice {
  situation: string;
  tips: string[];
  urgency: 'normal' | 'warning' | 'critical';
}

interface AdviceParams {
  currentKm: number;
  targetMarginMinutes: number | null;
  marginMinutes: number | null;
  currentPaceKmH: number;
  predictedPaceKmH: number;
  nightMode: boolean;
  isRaining: boolean;
}

const ADVICE: Record<string, { situation: string; tips: string[]; urgency: ActionAdvice['urgency'] }> = {
  cutoff_risk: {
    situation: '🚨 関門アウト予測',
    tips: ['今すぐ何か食べてエネルギー補給', '腕90度に曲げてリズムを作る', '痛みがあれば今すぐテーピング'],
    urgency: 'critical',
  },
  pace_drop: {
    situation: '⚠ ペースが急低下',
    tips: ['立ち止まって足を確認しよう', '左右均等に体重かかっているか', 'かばい歩きは膝を壊す注意'],
    urgency: 'critical',
  },
  severe_behind: {
    situation: '⚠ 大幅に遅れています',
    tips: ['歩幅より歩く速さを上げよう', '腕を90度に曲げて大きく振る', '次のCPだけを今の目標にする'],
    urgency: 'warning',
  },
  km70_final: {
    situation: '🔥 終盤・踏ん張りどころ',
    tips: ['頭を上げて前を見て歩こう', '腕を小さく速く振ってリズム', '痛みと疲れは別物、動ける'],
    urgency: 'normal',
  },
  night: {
    situation: '🌙 深夜モード',
    tips: ['声を出す・歌う・話す', '冷たい飲み物で覚醒を保つ', '2時前にカフェイン補給しよう'],
    urgency: 'normal',
  },
  km50_halfway: {
    situation: '💪 折り返し達成！',
    tips: ['残り半分じゃなく半分来た！', 'ゆっくりでも止まるな進め', '足裏・靴下を今すぐ確認'],
    urgency: 'normal',
  },
  km30_wall: {
    situation: '⚡ 中盤の壁（30〜40km）',
    tips: ['今すぐ炭水化物を補給しよう', '歩幅を少し小さくして省エネ', 'ここが一番きつい、抜けたら楽'],
    urgency: 'normal',
  },
  mild_behind: {
    situation: '⚠ 遅れています',
    tips: ['歩幅より歩く速さを上げよう', '腕を90度に曲げて大きく振る', '視線を15m先に向けて姿勢UP'],
    urgency: 'warning',
  },
  rain: {
    situation: '🌧 雨天モード',
    tips: ['足裏にワセリンを今すぐ塗る', '歩幅を狭くして滑り防止', '体が震えたらすぐ補給と防寒'],
    urgency: 'normal',
  },
  good: {
    situation: '✅ 余裕あり',
    tips: ['今のペースを崩さず維持しよう', '肩の力を抜いてリラックス', '足裏の違和感を今チェック'],
    urgency: 'normal',
  },
};

export function getActionAdvice(params: AdviceParams): ActionAdvice {
  const { currentKm, targetMarginMinutes, marginMinutes, currentPaceKmH, predictedPaceKmH, nightMode, isRaining } = params;

  // Priority 1: cutoff miss
  if (marginMinutes !== null && marginMinutes < 0) {
    return ADVICE.cutoff_risk;
  }

  // Priority 2: sudden pace drop (current pace < 65% of predicted)
  if (currentPaceKmH > 0 && predictedPaceKmH > 0 && currentPaceKmH < predictedPaceKmH * 0.65) {
    return ADVICE.pace_drop;
  }

  // Priority 3: severely behind target (>30 min)
  if (targetMarginMinutes !== null && targetMarginMinutes < -30) {
    return ADVICE.severe_behind;
  }

  // Priority 4: final stage
  if (currentKm >= 70) {
    return ADVICE.km70_final;
  }

  // Priority 5: night
  if (nightMode) {
    return ADVICE.night;
  }

  // Priority 6: halfway milestone
  if (currentKm >= 50 && currentKm < 60) {
    return ADVICE.km50_halfway;
  }

  // Priority 7: glycogen wall km30-40
  if (currentKm >= 30 && currentKm < 40) {
    return ADVICE.km30_wall;
  }

  // Priority 8: mildly behind target
  if (targetMarginMinutes !== null && targetMarginMinutes < 0) {
    return ADVICE.mild_behind;
  }

  // Priority 9: rain
  if (isRaining) {
    return ADVICE.rain;
  }

  return ADVICE.good;
}
