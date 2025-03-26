import { ActionFunctionArgs } from "@remix-run/node";
import { Buffer } from "buffer";
import * as Config from "../config/audioConfig";

const textToBinary = (text: string): string =>
  text
    .split("")
    .map((char) => char.charCodeAt(0).toString(2).padStart(8, "0"))
    .join("");

const generateToneData = (freq: number, duration: number): Float32Array => {
  const numSamples = Math.floor(duration * Config.SAMPLE_RATE);
  if (numSamples <= 0) return new Float32Array(0);

  const buffer = new Float32Array(numSamples);
  const baseAmplitude = Config.AMPLITUDE;

  for (let i = 0; i < numSamples; i++) {
    const time = i / Config.SAMPLE_RATE;
    let sampleValue = 0;

    const sineValue = Math.sin(2 * Math.PI * freq * time);

    let amMultiplier = 1.0;
    if (Config.ADD_AM_MODULATION && Config.AM_MODULATION_DEPTH > 0) {
      amMultiplier =
        1.0 -
        Config.AM_MODULATION_DEPTH +
        Config.AM_MODULATION_DEPTH *
          (0.5 +
            0.5 * Math.sin(2 * Math.PI * Config.AM_MODULATION_FREQ * time));
    }

    sampleValue = sineValue * amMultiplier * baseAmplitude;

    buffer[i] = Math.max(-1.0, Math.min(1.0, sampleValue));
  }
  return buffer;
};

const applyEnvelope = (signalData: Float32Array): Float32Array => {
  const N = signalData.length;
  if (N <= 1) return signalData;
  for (let n = 0; n < N; n++) {
    const multiplier = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    signalData[n] *= multiplier;
  }
  return signalData;
};

function bufferToWaveNode(channelData: Float32Array): Buffer {
  const numOfChan = 1;
  const bytesPerSample = 2;
  const dataSize = channelData.length * numOfChan * bytesPerSample;
  const fileSize = dataSize + 44;
  const buffer = Buffer.alloc(fileSize);
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  let pos = 0;
  function setString(str: string) {
    for (let i = 0; i < str.length; i++)
      view.setUint8(pos++, str.charCodeAt(i));
  }
  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }
  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
  setString("RIFF");
  setUint32(fileSize - 8);
  setString("WAVE");
  setString("fmt ");
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(Config.SAMPLE_RATE);
  setUint32(Config.SAMPLE_RATE * numOfChan * bytesPerSample);
  setUint16(numOfChan * bytesPerSample);
  setUint16(bytesPerSample * 8);
  setString("data");
  setUint32(dataSize);
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    const intSample = sample < 0 ? sample * 32768 : sample * 32767;
    view.setInt16(pos, intSample, true);
    pos += bytesPerSample;
  }
  return buffer;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    const message = formData.get("message") as string;
    if (!message)
      return Response.json({ error: "Message required" }, { status: 400 });

    console.log(`[Server Encode AM Melodic] Encoding: "${message}"`);
    const binaryMessage = textToBinary(message);
    let fecBinaryMessage = "";
    const redundancy = Config.FEC_REDUNDANCY || 1;
    for (const bit of binaryMessage) {
      fecBinaryMessage += bit.repeat(redundancy);
    }

    const numBits = fecBinaryMessage.length;
    const totalDuration =
      Config.SYNC_TONE_DURATION +
      numBits * Config.BIT_DURATION +
      Config.END_TONE_DURATION;
    const numSamples = Math.floor(totalDuration * Config.SAMPLE_RATE);
    console.log(
      `[Enc AM Melodic] Config: SR=${Config.SAMPLE_RATE}, BR=${Config.BIT_RATE}, F0=${Config.FREQ_0}, F1=${Config.FREQ_1}, AM=${Config.ADD_AM_MODULATION}`
    );
    console.log(
      `[Enc AM Melodic] Bits: ${numBits}. Duration: ${totalDuration.toFixed(
        3
      )}s, Samples: ${numSamples}`
    );

    const channelData = new Float32Array(numSamples);
    let currentOffset = 0;

    const addToneData = (freq: number, duration: number, isEndTone = false) => {
      let toneData = generateToneData(freq, duration);
      toneData = applyEnvelope(toneData);
      const samplesToAdd = toneData.length;
      const spaceLeft = channelData.length - currentOffset;
      if (samplesToAdd <= spaceLeft) {
        channelData.set(toneData, currentOffset);
        currentOffset += samplesToAdd;
      } else if (spaceLeft > 0) {
        channelData.set(toneData.subarray(0, spaceLeft), currentOffset);
        currentOffset += spaceLeft;
        console.warn(`[Enc AM Melodic] Tone truncated.`);
      }
      if (isEndTone)
        console.log(
          `[Enc AM Melodic] Added End Tone. Offset: ${currentOffset}`
        );
    };

    addToneData(Config.SYNC_TONE_FREQ, Config.SYNC_TONE_DURATION);
    for (let i = 0; i < numBits; i++) {
      addToneData(
        fecBinaryMessage[i] === "0" ? Config.FREQ_0 : Config.FREQ_1,
        Config.BIT_DURATION
      );
    }
    addToneData(Config.END_TONE_FREQ, Config.END_TONE_DURATION, true);

    console.log(
      `[Enc AM Melodic] Finished. Offset ${currentOffset} / ${numSamples}.`
    );

    const wavBuffer = bufferToWaveNode(channelData);
    const base64Data = wavBuffer.toString("base64");
    return Response.json({
      audioData: base64Data,
      fileName: `encoded_melodic.wav`,
    });
  } catch (error) {}
  return Response.json({ error: "Unknown encoding error." }, { status: 500 });
}
