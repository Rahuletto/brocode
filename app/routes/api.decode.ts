import {
  ActionFunctionArgs,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { Buffer } from "buffer";
import * as Config from "../config/audioConfig";
import lamejs from "lamejs";

const GOERTZEL_ENERGY_THRESHOLD = Config.GOERTZEL_ENERGY_THRESHOLD;
const SYNC_DETECTION_MULTIPLIER = Config.SYNC_DETECTION_MULTIPLIER;
const BIT_DECISION_RATIO_THRESHOLD = Config.BIT_DECISION_RATIO_THRESHOLD;

const binaryToText = (binary: string): string => {
  const validLength = binary.length - (binary.length % 8);
  const validBinary = binary.substring(0, validLength);
  if (validLength !== binary.length)
    console.warn(
      `[binaryToText] Truncated ${binary.length - validLength} bits.`
    );
  if (!validBinary) {
    console.warn("[binaryToText] No valid binary after length check.");
    return "";
  }
  const bytes = validBinary.match(/.{1,8}/g);
  if (!bytes) return "";
  console.log(`[binaryToText] Processing ${bytes.length} bytes.`);
  return bytes
    .map((byte, index) => {
      try {
        const charCode = parseInt(byte, 2);
        if (
          isNaN(charCode) ||
          charCode === 0 ||
          charCode < 32 ||
          (charCode > 126 && charCode < 160)
        ) {
          if (charCode === 0) {
          } else {
          }
          return "";
        }
        return String.fromCharCode(charCode);
      } catch (e) {
        console.error(`[binaryToText] Error parsing byte "${byte}"`, e);
        return "?";
      }
    })
    .join("");
};

const goertzel = (
  samples: Float32Array,
  freq: number,
  sampleRate: number
): number => {
  if (samples.length === 0) return 0;
  const k = Math.floor(0.5 + (samples.length * freq) / sampleRate);
  const omega = (2.0 * Math.PI * k) / samples.length;
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const coeff = 2.0 * cosOmega;
  let q0 = 0.0,
    q1 = 0.0,
    q2 = 0.0;
  for (let i = 0; i < samples.length; i++) {
    q0 = samples[i] + coeff * q1 - q2;
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * cosOmega;
  const imag = q2 * sinOmega;
  return real * real + imag * imag;
};

function parseWavBuffer(wavBuffer: Buffer): {
  channelData: Float32Array | null;
  sampleRate: number | null;
  error?: string;
} {
  try {
    if (wavBuffer.length < 44)
      return { channelData: null, sampleRate: null, error: "File too small" };
    if (wavBuffer.toString("utf8", 0, 4) !== "RIFF")
      return { channelData: null, sampleRate: null, error: "No 'RIFF'" };
    if (wavBuffer.toString("utf8", 8, 12) !== "WAVE")
      return { channelData: null, sampleRate: null, error: "No 'WAVE'" };
    if (wavBuffer.toString("utf8", 12, 16) !== "fmt ")
      return { channelData: null, sampleRate: null, error: "No 'fmt '" };
    const fmtChunkSize = wavBuffer.readUInt32LE(16);
    if (fmtChunkSize < 16)
      return {
        channelData: null,
        sampleRate: null,
        error: "Invalid 'fmt ' size.",
      };
    const audioFormat = wavBuffer.readUInt16LE(20);
    if (audioFormat !== 1)
      return {
        channelData: null,
        sampleRate: null,
        error: `Unsupported format: ${audioFormat}`,
      };
    const numChannels = wavBuffer.readUInt16LE(22);
    if (numChannels !== 1)
      return {
        channelData: null,
        sampleRate: null,
        error: `Unsupported channels: ${numChannels}`,
      };
    const fileSampleRate = wavBuffer.readUInt32LE(24);
    const bitsPerSample = wavBuffer.readUInt16LE(34);
    if (bitsPerSample !== 16)
      return {
        channelData: null,
        sampleRate: null,
        error: `Unsupported bits: ${bitsPerSample}`,
      };
    let dataChunkOffset = -1,
      dataChunkSize = 0;
    let currentOffset = 12;
    while (currentOffset < wavBuffer.length - 8) {
      const chunkId = wavBuffer.toString(
        "utf8",
        currentOffset,
        currentOffset + 4
      );
      const chunkSize = wavBuffer.readUInt32LE(currentOffset + 4);
      if (chunkId === "data") {
        dataChunkOffset = currentOffset + 8;
        dataChunkSize = chunkSize;
        break;
      }
      currentOffset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) currentOffset++;
    }
    if (dataChunkOffset === -1)
      return {
        channelData: null,
        sampleRate: null,
        error: "'data' chunk not found",
      };
    const dataEndOffset = dataChunkOffset + dataChunkSize;
    if (dataEndOffset > wavBuffer.length) {
      console.warn(`'data' chunk overflow corrected.`);
      dataChunkSize = wavBuffer.length - dataChunkOffset;
    }
    const bytesPerSample = bitsPerSample / 8;
    const numSamples = Math.floor(dataChunkSize / bytesPerSample / numChannels);
    if (numSamples <= 0)
      return { channelData: null, sampleRate: null, error: "No samples." };
    const samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const byteOffset = dataChunkOffset + i * bytesPerSample;
      if (byteOffset + bytesPerSample > wavBuffer.length) {
        console.warn("Read overflow extract");
        samples.set(samples.subarray(0, i));
        break;
      }
      const intSample = wavBuffer.readInt16LE(byteOffset);
      samples[i] = intSample / 32768.0;
    }
    return { channelData: samples, sampleRate: fileSampleRate };
  } catch (err) {
    return {
      channelData: null,
      sampleRate: null,
      error: `WAV Parse Error: ${
        err instanceof Error ? err.message : "Unknown"
      }`,
    };
  }
}

// Function to decode MP3 data using lamejs
function decodeMp3(mp3Data: Buffer): {
  channelData: Float32Array | null;
  sampleRate: number | null;
  error?: string;
} {
  try {
    const mp3Decoder = new lamejs.Mp3Decoder();
    mp3Decoder.decodeBuffer(mp3Data);

    const buffer = mp3Decoder.flush();

    if (buffer.length === 0) {
      return { channelData: null, sampleRate: null, error: "No decoded data" };
    }

    const numChannels = 1; // Assuming mono audio
    const fileSampleRate = 44100; // You might need to adjust this based on your audio source
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const numSamples = buffer.length / numChannels;

    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const intSample = buffer[i];
      samples[i] = intSample / 32768.0;
    }

    return { channelData: samples, sampleRate: fileSampleRate };
  } catch (error) {
    return {
      channelData: null,
      sampleRate: null,
      error: `MP3 Decode Error: ${
        error instanceof Error ? error.message : "Unknown"
      }`,
    };
  }
}

function performDecoding(
  channelData: Float32Array,
  fileSampleRate: number
): { decodedText: string; error?: string } {
  console.log(
    `[Server Decode] Starting. SR=${fileSampleRate}, Samples=${channelData.length}`
  );
  if (fileSampleRate !== Config.SAMPLE_RATE)
    return {
      decodedText: "",
      error: `SR mismatch: File=${fileSampleRate}, Expected=${Config.SAMPLE_RATE}`,
    };

  let binaryMessage = "";
  const bitDurationSamples = Config.BIT_DURATION_SAMPLES;
  const syncSamples = Config.SYNC_SAMPLES;

  const requiredSyncEnergy =
    GOERTZEL_ENERGY_THRESHOLD * SYNC_DETECTION_MULTIPLIER;

  console.log(
    `[Server Decode] Bit Samples: ${bitDurationSamples.toFixed(
      1
    )}, Sync Samples: ${syncSamples}`
  );
  console.log(
    `[Server Decode] Req Sync E > ${requiredSyncEnergy.toExponential(3)}`
  );

  let syncIndex = -1;
  const syncSearchEnd = channelData.length - syncSamples;
  let maxSyncEnergy = 0;
  console.log(`[Server Decode] Searching sync (${Config.SYNC_TONE_FREQ}Hz)...`);
  for (let i = 0; i < syncSearchEnd; i += Math.floor(syncSamples / 5)) {
    const segment = channelData.subarray(i, i + syncSamples);
    if (segment.length < syncSamples * 0.8) continue;
    const energy = goertzel(segment, Config.SYNC_TONE_FREQ, Config.SAMPLE_RATE);
    maxSyncEnergy = Math.max(maxSyncEnergy, energy);
    if (energy > requiredSyncEnergy) {
      syncIndex = i;
      console.log(
        `[Server Decode] Sync found @ index ${syncIndex}, E=${energy.toExponential(
          3
        )}`
      );
      break;
    }
  }
  if (syncIndex === -1) {
    console.warn(
      `[Server Decode] Sync NOT found (Max E: ${maxSyncEnergy.toExponential(
        3
      )}).`
    );
    return {
      decodedText: "",
      error: `Sync tone not detected (Max E: ${maxSyncEnergy.toExponential(
        3
      )})`,
    };
  }

  let bitIndex = Math.floor(syncIndex + syncSamples);
  const maxBitsToDecode = 20000;
  let bitsDecoded = 0;

  console.log(
    `[Server Decode] Starting bit decoding from sample index ${bitIndex}`
  );

  while (
    bitIndex + bitDurationSamples <= channelData.length &&
    bitsDecoded < maxBitsToDecode
  ) {
    const currentBitStart = Math.floor(bitIndex);
    const currentBitEnd = Math.min(
      currentBitStart + Math.floor(bitDurationSamples),
      channelData.length
    );
    const analysisStart =
      currentBitStart + Math.floor(bitDurationSamples * 0.15);
    const analysisEnd = currentBitEnd - Math.floor(bitDurationSamples * 0.15);

    if (analysisStart >= analysisEnd || currentBitEnd <= currentBitStart) {
      console.warn(
        `[Server Decode] Invalid window @ bit ${bitsDecoded}. Stop.`
      );
      break;
    }
    const segment = channelData.subarray(analysisStart, analysisEnd);

    const energy0 = goertzel(segment, Config.FREQ_0, Config.SAMPLE_RATE);
    const energy1 = goertzel(segment, Config.FREQ_1, Config.SAMPLE_RATE);

    let bit: "0" | "1";
    if (energy1 > energy0 * BIT_DECISION_RATIO_THRESHOLD) bit = "1";
    else if (energy0 > energy1 * BIT_DECISION_RATIO_THRESHOLD) bit = "0";
    else bit = energy1 >= energy0 ? "1" : "0";

    binaryMessage += bit;
    bitsDecoded++;
    const nextBitIndex = bitIndex + bitDurationSamples;

    bitIndex = nextBitIndex;

    if (bitsDecoded <= 24 || bitsDecoded % 200 === 0) {
      console.log(
        `[Server Decode] Bit ${bitsDecoded - 1} -> ${bit}. Total Binary (${
          binaryMessage.length
        }): "${binaryMessage.slice(-80)}..."`
      );
    }
  }

  if (bitsDecoded >= maxBitsToDecode)
    console.warn(
      `[Server Decode] Loop STOPPED by max bit limit (${maxBitsToDecode}).`
    );
  else
    console.log(
      `[Server Decode] Loop STOPPED by buffer end or invalid segment after ${bitsDecoded} bits.`
    );
  console.log(`[Server Decode] Total raw bits found: ${bitsDecoded}`);
  console.log(
    `[Server Decode] Raw Binary END (${
      binaryMessage.length
    } bits): "...${binaryMessage.slice(-160)}"`
  );

  if (bitsDecoded < 8)
    return {
      decodedText: "",
      error: `Insufficient bits decoded (${bitsDecoded})`,
    };

  let deFecBinary = "";
  const redundancy = Config.FEC_REDUNDANCY || 1;
  if (redundancy > 1 && bitsDecoded >= redundancy) {
  } else {
    deFecBinary = binaryMessage;
  }
  console.log(`[Server Decode] De-FEC Binary (${deFecBinary.length} bits)`);

  if (deFecBinary.length < 8)
    return {
      decodedText: "",
      error: `Insufficient bits after FEC (${deFecBinary.length})`,
    };

  const decodedText = binaryToText(deFecBinary);
  console.log(`[Server Decode] Final Text Length: ${decodedText.length}`);
  return { decodedText };
}
export async function action({ request }: ActionFunctionArgs) {
  console.log("--- Decode API Request ---");
  const uploadHandler = unstable_createMemoryUploadHandler({
    maxPartSize: 5 * 10 * 1024 * 1024,
  });

  try {
    const formData = await unstable_parseMultipartFormData(
      request,
      uploadHandler
    );
    const audioFile = formData.get("audioFile") as File | null;

    if (!audioFile || typeof audioFile.arrayBuffer !== "function") {
      return Response.json({ error: "Audio file required" }, { status: 400 });
    }

    let channelData: Float32Array | null = null;
    let sampleRate: number | null = null;
    let parseError: string | undefined = undefined;

    // Handle WAV files (either original or converted)
    if (
      audioFile.type.startsWith("audio/wav") ||
      audioFile.type.startsWith("audio/wave")
    ) {
      const arrayBuffer = await audioFile.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      const wavResult = parseWavBuffer(fileBuffer);
      channelData = wavResult.channelData;
      sampleRate = wavResult.sampleRate;
      parseError = wavResult.error;
    }
    // Handle MP3 files
    else if (audioFile.type.startsWith("audio/mp3")) {
      const arrayBuffer = await audioFile.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      const mp3Result = decodeMp3(fileBuffer);
      channelData = mp3Result.channelData;
      sampleRate = mp3Result.sampleRate;
      parseError = mp3Result.error;
    }
    // Handle other audio types (like webm from MediaRecorder)
    else {
      try {
        // Convert to WAV client-side before sending
        return Response.json(
          { error: "Please convert audio to WAV format before uploading" },
          { status: 400 }
        );
      } catch (e) {
        return Response.json(
          {
            error: `Audio conversion failed: ${
              e instanceof Error ? e.message : "Unknown"
            }`,
          },
          { status: 400 }
        );
      }
    }

    // Rest of your decoding logic...
    if (parseError || !channelData || sampleRate === null) {
      return Response.json(
        { error: `Audio Parse Fail: ${parseError || "Unknown"}` },
        { status: 400 }
      );
    }

    const { decodedText, error: decodeError } = performDecoding(
      channelData,
      sampleRate
    );
    if (decodeError) {
      return Response.json(
        { error: `Decode Fail: ${decodeError}` },
        { status: 500 }
      );
    }

    return Response.json({
      decodedText: decodedText || "(Empty result)",
    });
  } catch (error) {
    console.error("Decode API Route Error:", error);
    if (error instanceof Error && error.message.includes("maxPartSize")) {
      return Response.json({ error: "File too large." }, { status: 413 });
    }
    return Response.json(
      {
        error: `Server Error: ${
          error instanceof Error ? error.message : "Unknown"
        }`,
      },
      { status: 500 }
    );
  }
}
