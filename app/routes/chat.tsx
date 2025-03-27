import { Link, useFetcher } from "@remix-run/react";
import React, { useEffect, useState, useRef, useCallback } from "react";
import * as Config from "../config/audioConfig";

function createWavBlob(audioData: Float32Array, sampleRate = Config.SAMPLE_RATE): Blob {
    const buffer = new ArrayBuffer(44 + audioData.length * 2);
    const view = new DataView(buffer);

    // Write WAV header
    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 32 + audioData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true); // BlockAlign
    view.setUint16(34, 16, true); // Bits per sample
    writeString(36, 'data');
    view.setUint32(40, audioData.length * 2, true);

    // Convert to 16-bit PCM
    const volume = 1;
    let offset = 44;
    for (let i = 0; i < audioData.length; i++, offset += 2) {
        const sample = Math.max(-1, Math.min(1, audioData[i] * volume));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
}

export default function Chat() {
    const [started, setStarted] = useState(false);
    const [transcription2, setTranscription2] = useState("");
    const [initialEncodedMessage, setInitialEncodedMessage] =
        useState("Hello, I am an AI Agent");
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const encodeFetcher = useFetcher();
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<"agent1" | "agent2">(
        "agent1"
    );
    const [listening, setListening] = useState(false);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);
    const [supportedMimeType, setSupportedMimeType] = useState<string | null>(
        null
    );

    useEffect(() => {
        // Determine the supported MIME type
        if (MediaRecorder.isTypeSupported("audio/wav")) {
            setSupportedMimeType("audio/wav");
        } else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
            setSupportedMimeType("audio/webm;codecs=opus");
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
            setSupportedMimeType("audio/webm");
        } else {
            setSupportedMimeType(null); // Let the browser choose
        }
    }, []);

    const initializeAudioContext = useCallback(() => {
        if (audioContextRef.current) return;

        const audioContext = new (window.AudioContext ||
            (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyserRef.current = analyser;
    }, []);

    const sendAudioToDecode = useCallback(async (audioBlob: Blob) => {
        try {
            const formData = new FormData();
            formData.append("audioFile", audioBlob, "recording.wav"); // Always name it "recording.wav"
            formData.append("agent", "agent2");

            const response = await fetch("/api/decode", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            setTranscription2(data.transcription2 || "");
        } catch (error) {
            console.error("Error sending audio:", error);
        }
    }, []);

    useEffect(() => {
        const initializeMediaRecorder = async () => {
            if (started && selectedAgent === "agent2" && listening) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: true,
                    });

                    const mediaRecorderOptions = supportedMimeType
                        ? { mimeType: supportedMimeType }
                        : {};

                    mediaRecorder.current = new MediaRecorder(stream, mediaRecorderOptions);
                    initializeAudioContext();
                    audioChunks.current = [];

                    mediaRecorder.current.ondataavailable = (event) => {
                        audioChunks.current.push(event.data);
                    };

                    mediaRecorder.current.onstop = async () => {
                        try {
                            // 1. Concatenate Audio Chunks
                            const audioBlob = new Blob(audioChunks.current, {
                                type: supportedMimeType || "audio/webm"
                            });

                            // 2. Create Audio Context and Buffer Source
                            const audioContext = new AudioContext({ sampleRate: Config.SAMPLE_RATE });
                            const arrayBuffer = await audioBlob.arrayBuffer();
                            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                            const audioData = audioBuffer.getChannelData(0);

                            // 3. Create WAV Blob
                            const wavBlob = createWavBlob(audioData);
                            audioChunks.current = [];

                            // 4. Send WAV Blob to Server
                            const result = await sendAudioToDecode(wavBlob);
                            console.log('Decoding result:', result);

                        } catch (error) {
                            console.error('Error processing recording:', error);
                        }
                    };

                    mediaRecorder.current.start();
                } catch (error: any) {
                    console.error("Error accessing microphone:", error);
                    setStarted(false);
                    setListening(false);
                    // Handle permission denial more gracefully
                    if (error.name === "NotAllowedError") {
                        alert(
                            "Microphone access was denied. Please check your browser settings."
                        );
                    }
                }
            } else if (mediaRecorder.current) {
                if (mediaRecorder.current.state === "recording") {
                    mediaRecorder.current.stop();
                }
                if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                    audioContextRef.current.close().then(() => {
                        audioContextRef.current = null;
                        analyserRef.current = null;
                    });
                }
            }
        };

        initializeMediaRecorder();

        return () => {
            if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
                mediaRecorder.current.stop();
            }
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                audioContextRef.current.close().then(() => {
                    audioContextRef.current = null;
                    analyserRef.current = null;
                });
            }
        };
    }, [
        started,
        initializeAudioContext,
        selectedAgent,
        listening,
        sendAudioToDecode,
        supportedMimeType,
    ]);

    useEffect(() => {
        if (encodeFetcher.data && typeof encodeFetcher.data === "object" && "audioData" in encodeFetcher.data) {
            const audioData = encodeFetcher.data.audioData as string;
            try {
                const byteCharacters = atob(audioData);
                const byteArrays: Uint8Array[] = [];

                for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                    const slice = byteCharacters.slice(offset, offset + 512);

                    const byteNumbers = new Array(slice.length);
                    for (let i = 0; i < slice.length; i++) {
                        byteNumbers[i] = slice.charCodeAt(i);
                    }

                    const byteArray = new Uint8Array(byteNumbers);
                    byteArrays.push(byteArray);
                }

                const audioBlob = new Blob(byteArrays, { type: "audio/wav" });

                if (selectedAgent === "agent1") {
                    const url = URL.createObjectURL(audioBlob);
                    if (!audioElementRef.current) {
                        audioElementRef.current = new Audio();
                    }
                    audioElementRef.current.src = url;
                    audioElementRef.current.controls = true;
                    audioElementRef.current.onended = () => {
                        URL.revokeObjectURL(url);
                    };
                    audioElementRef.current.play();
                }
            } catch (e) {
                console.error("error atob", e);
            }
        }
    }, [encodeFetcher.data, selectedAgent]);

    const handleStart = async () => {
        setTranscription2("");
        setStarted(true);
        if (selectedAgent === "agent1") {
            const formData = new FormData();
            formData.append("message", initialEncodedMessage);
            encodeFetcher.submit(formData, { method: "post", action: "/api/encode" });
        }
    };

    const handleEnd = () => {
        setStarted(false);
        setListening(false);
    };

    const handleAgentSelect = (agent: "agent1" | "agent2") => {
        setSelectedAgent(agent);
        setListening(false);
        setStarted(false);
        audioChunks.current = [];
    };

    const handleStartListening = () => {
        setTranscription2("");
        setListening(true);
    };

    const handleStopListening = () => {
        setListening(false);
        if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
            mediaRecorder.current.stop();
        }
    };

    return (
        <main className="bg-background min-h-screen px-4 sm:px-12 md:px-24 py-10 md:py-14 text-foreground">
            <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center">
                <h1 className="text-3xl sm:text-4xl font-semibold text-left">
                    Bro Code
                </h1>
                <div className="flex items-center justify-center">
                    <div className="flex justify-center gap-4 bg-black/40 rounded-full w-fit">
                        <Link
                            className={`py-3 px-8 rounded-full text-lg font-semibold focus:outline-none transition-colors duration-200 ease-in-out text-foreground/60 hover:text-foreground/80`}
                            to="/#encode"
                        >
                            Encode
                        </Link>
                        <Link
                            className={`py-3 px-8 rounded-full text-lg font-semibold focus:outline-none transition-colors duration-200 ease-in-out text-foreground/60 hover:text-foreground/80`}
                            to="/#decode"
                        >
                            Decode
                        </Link>
                        <Link
                            to="/chat"
                            className={`py-3 px-8 rounded-full text-lg font-semibold focus:outline-none transition-colors duration-200 ease-in-out bg-foreground text-background`}
                        >
                            Chat
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-3xl mx-auto h-full mt-12 min-h-[70vh] flex items-center flex-col justify-center">
                {started ? (
                    <div className="flex flex-col gap-8 items-center justify-center">
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-2 flex-col">
                                <div className={`border-8 border-foreground shadow-[0px_0px_16px_var(--foreground-shadow)] w-48 h-48 rounded-full ${listening ? "animate-breathe bg-foreground/80 opacity-100" : "bg-foreground/10 opacity-50"} `} />
                                <div>
                                    <p>{transcription2}</p>
                                </div>
                            </div>
                        </div>
                        {selectedAgent === "agent2" && (
                            <div>
                                {!listening ? (
                                    <button
                                        onClick={handleStartListening}
                                        className="px-10 py-3 text-lg mb-32 font-semibold bg-foreground text-background border-2 border-foreground rounded-full"
                                    >
                                        Start Listening
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleStopListening}
                                        className="px-10 py-3 text-lg mb-32 font-semibold bg-red-500 text-background border-2 border-red-500 rounded-full"
                                    >
                                        Stop Listening
                                    </button>
                                )}
                            </div>
                        )}
                        <button
                            onClick={handleEnd}
                            className="px-10 w-fit py-3 text-2xl font-semibold text-foreground border-2 border-foreground rounded-full"
                        >
                            End
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 items-center">
                        <button
                            onClick={handleStart}
                            className="px-10 py-3 text-2xl shadow-[0px_0px_16px_var(--foreground-shadow)] font-semibold text-background bg-foreground rounded-full"
                        >
                            Start
                        </button>
                        <div className="flex gap-4 mt-24">
                            <button
                                className={`px-8 py-3 text-lg font-semibold rounded-full focus:outline-none transition-colors duration-200 ease-in-out ${selectedAgent === "agent1"
                                    ? "bg-foreground text-background"
                                    : "text-foreground bg-black/40 hover:text-foreground/80"
                                    }`}
                                onClick={() => handleAgentSelect("agent1")}
                            >
                                Agent 1
                            </button>
                            <button
                                className={`px-8 py-3 text-lg font-semibold rounded-full focus:outline-none transition-colors duration-200 ease-in-out ${selectedAgent === "agent2"
                                    ? "bg-foreground text-background"
                                    : "text-foreground bg-black/40 hover:text-foreground/80"
                                    }`}
                                onClick={() => handleAgentSelect("agent2")}
                            >
                                Agent 2
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <audio ref={audioElementRef} style={{ display: "none" }} />
        </main>
    );
}
