export const SAMPLE_RATE = 44100;
export const AMPLITUDE = 0.3;

export const BIT_RATE = 100;
export const FREQ_0 = 523.25;
export const FREQ_1 = 659.25;

export const ADD_AM_MODULATION = true;
export const AM_MODULATION_FREQ = 4;
export const AM_MODULATION_DEPTH = 0.4;

export const SYNC_TONE_FREQ = 800;
export const SYNC_TONE_DURATION = 0.1;
export const END_TONE_FREQ = 2500;
export const END_TONE_DURATION = 0.1;

export const ADD_HARMONICS = false;
export const HARMONIC_2_AMPLITUDE_FACTOR = 0.0;
export const HARMONIC_3_AMPLITUDE_FACTOR = 0.0;

export const FEC_REDUNDANCY = 1;

export const GOERTZEL_ENERGY_THRESHOLD = 1e-8;
export const SYNC_DETECTION_MULTIPLIER = 3.0;
export const END_DETECTION_MULTIPLIER = 4.0;
export const END_DETECTION_CONFIRMATIONS = 3;
export const BIT_DECISION_RATIO_THRESHOLD = 1.4;
export const MIN_RAW_BITS_BEFORE_END_CHECK = 64;

export const BIT_DURATION = 1 / BIT_RATE;
export const BIT_DURATION_SAMPLES = Math.max(
  1,
  Math.floor(SAMPLE_RATE / BIT_RATE)
);
export const SYNC_SAMPLES = Math.floor(SYNC_TONE_DURATION * SAMPLE_RATE);
export const END_SAMPLES = Math.floor(END_TONE_DURATION * SAMPLE_RATE);

if (FREQ_0 >= FREQ_1) console.warn("Config Warning: FREQ_0 >= FREQ_1");
if (BIT_DURATION_SAMPLES < 50)
  console.warn(
    `Config Warning: BIT_DURATION_SAMPLES (${BIT_DURATION_SAMPLES.toFixed(
      1
    )}) low.`
  );
if (AM_MODULATION_DEPTH < 0 || AM_MODULATION_DEPTH > 1)
  console.warn("Config Warning: AM_MODULATION_DEPTH out of range.");
if (END_DETECTION_CONFIRMATIONS < 1)
  console.warn(
    "Config Warning: END_DETECTION_CONFIRMATIONS should be at least 1."
  );


export const NUM_CHANNELS = 1; // Mono audio
export const BITS_PER_SAMPLE = 16;
