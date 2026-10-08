export const FEEDBACK = {
  formation: {
    question: 'Does the initial pump match your setup?',
    help: 'Judge the earlier rise and its volume against your initial-pump example, separately from what happened afterwards.',
    options: {
      match: ['Matches', 'A meaningful price rise, possibly over hours, with convincing activity relative to this coin’s own earlier volume.'],
      partial: ['Partial match', 'Some features match, but the rise, candle structure or volume is less convincing. Explain which part.'],
      no_match: ['Does not match', 'The earlier move lacks the initial pump and volume structure you want to detect.'],
      unsure: ['Unsure', 'You cannot confidently judge the initial pump from the available history.'],
    },
  },
  base: {
    question: 'What is happening after the initial pump?',
    help: 'A base is a supported range after the pump and pullback: price repeatedly holds between a floor and a ceiling. Both boundaries may stay level or gradually rise together. Small swings around that slope can still be tight. This is not proof of who is accumulating.',
    options: {
      still_pumping: ['Initial pump still developing', 'The initial upward move is still unfolding, with no clear post-pump range yet. High volume alone does not decide this.'],
      too_early: ['Not enough post-pump history', 'A pullback or pause has started, but there are too few completed candles or repeated tests to judge a base. This replaces the vague “Too early” label.'],
      forming: ['Possible base forming', 'The selloff is slowing, lows are holding and a sideways or gently rising range is appearing, but it has had few tests.'],
      established: ['Base holding across repeated tests', 'A visible floor and ceiling have held through multiple tests across more candles. This describes the chart so far, not a guaranteed breakout.'],
      not_forming: ['No sustained base', 'The chart keeps making lower lows, moving erratically, or climbing without repeated small pullbacks and a supported range. A gentle rising base can qualify. Use “Cannot judge” for missing data.'],
      failed: ['Earlier base broke down', 'A previously visible base has lost its floor and is no longer holding. A single wick does not automatically establish failure.'],
      unclear: ['Cannot judge from data', 'Missing candles, sparse trading or conflicting structure prevent a useful assessment.'],
    },
  },
  scope: {
    question: 'Would you want charts like this in your watchlist?',
    help: 'Judge fit with your research preferences. The $30k–$250k band is a preference for the later base; below/above it is not automatic rejection. Bases may develop for weeks or longer.',
    options: {
      in_scope: ['Yes, fits my setup', 'You want the scanner to find and keep following charts like this.'],
      borderline: ['Borderline', 'Some features fit, but you would give this chart lower priority. Explain why.'],
      out_of_scope: ['No, outside my setup', 'This type of chart is not useful for your intended setup, even if a price pattern was detected.'],
      unsure: ['Unsure', 'You have not decided whether this belongs in your research scope.'],
    },
  },
  reason: {
    question: 'Main reason for your assessment',
    help: 'Choose the strongest reason for your answers. Notes can capture any additional reasons.',
    options: {
      good_structure: ['Good structure', 'The initial pump or later range resembles the structure you are looking for. Say which in the notes.'],
      weak_rise: ['Pump too weak', 'The rise is too small, too brief or lacks enough advancing candles.'],
      weak_volume: ['Volume unconvincing', 'The pump lacks convincing trading activity relative to the surrounding chart. Missing volume history is a data gap.'],
      too_extended: ['Already too extended', 'Price has moved too far from the area you want to study or the alert arrived too late; this is not simply “above $250k”.'],
      volatile_base: ['Range too unstable', 'Repeated large swings or failed holds prevent a convincing supported range, whether sideways or gently rising.'],
      too_early: ['Needs more time', 'The chart needs more development before you can judge it. There is no two-day cutoff.'],
      data_gap: ['Missing or unreliable data', 'History, volume, market-cap information or source freshness is insufficient.'],
      outside_scope: ['Outside my setup', 'A preference other than the listed structure reasons makes this chart unsuitable. Explain in notes.'],
      other: ['Other / see notes', 'The main reason is not covered by these choices.'],
    },
  },
} as const;
export type FeedbackField = keyof typeof FEEDBACK;
export const feedbackLabels = (field: FeedbackField): Record<string,string> => Object.fromEntries(Object.entries(FEEDBACK[field].options).map(([key,value])=>[key,value[0]]));
export const feedbackHelp = (field: FeedbackField, value: string): string =>
  (FEEDBACK[field].options as Record<string,readonly [string,string]>)[value]?.[1] ?? FEEDBACK[field].help;
