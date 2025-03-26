
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFetcher } from "@remix-run/react";
import { LinksFunction, MetaFunction } from '@remix-run/node';

import { SAMPLE_RATE } from '../config/audioConfig';

export const meta: MetaFunction = () => {
  return [{ title: "Audio Text Encoder/Decoder" }];
};

function base64ToBlob(base64: string, contentType: string = 'audio/wav'): Blob | null {
  try { const byteCharacters = atob(base64); const byteNumbers = new Array(byteCharacters.length); for (let i = 0; i < byteCharacters.length; i++) { byteNumbers[i] = byteCharacters.charCodeAt(i); } const byteArray = new Uint8Array(byteNumbers); return new Blob([byteArray], { type: contentType }); } catch (error) { console.error("Error decoding base64:", error); return null; }
}


export default function IndexPage() {
  const [messageToEncode, setMessageToEncode] = useState("");
  const [decodedMessage, setDecodedMessage] = useState("");
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isEncoding, setIsEncoding] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  type EncodeResponse = { audioData: string; fileName: string } | { error: string };
  const encodeFetcher = useFetcher<EncodeResponse>();
  type DecodeResponse = { decodedText: string } | { error: string };
  const decodeFetcher = useFetcher<DecodeResponse>();



  useEffect(() => {
    if (typeof window !== 'undefined') {
      try { if (!audioContextRef.current || audioContextRef.current.state === 'closed') audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE }); }
      catch (e) { console.error("AC error.", e); setErrorMessage("Web Audio API not supported."); }
      const savedTheme = localStorage.getItem('audioTheme') as 'light' | 'dark' || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    return () => { if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close().catch(e => console.error("Error closing AC:", e)); };
  }, []);


  useEffect(() => {
    let currentAudioSrc: string | null = null;
    if (encodeFetcher.state === 'loading') { setIsEncoding(true); setErrorMessage(null); setAudioSrc(null); setDecodedMessage(""); } else { setIsEncoding(false); }
    if (encodeFetcher.data && encodeFetcher.state === 'idle') {
      let newErrorMessage: string | null = null;
      if (typeof encodeFetcher.data === 'object' && encodeFetcher.data !== null) {
        if ('audioData' in encodeFetcher.data && typeof encodeFetcher.data.audioData === 'string') {
          const blob = base64ToBlob(encodeFetcher.data.audioData);
          if (blob) { try { currentAudioSrc = URL.createObjectURL(blob); setAudioSrc(currentAudioSrc); } catch (e) { newErrorMessage = "Failed url."; console.error(e); } }
          else { newErrorMessage = "Failed blob."; }
        } else if ('error' in encodeFetcher.data) { newErrorMessage = `Encoding Error: ${encodeFetcher.data.error}`; setAudioSrc(null); }
        else { newErrorMessage = "Unexpected JSON."; console.error("Unexpected JSON:", encodeFetcher.data); setAudioSrc(null); }
      } else { newErrorMessage = "Invalid response."; console.error("Non-object response:", encodeFetcher.data); setAudioSrc(null); }
      setErrorMessage(newErrorMessage);
    }
    return () => { if (currentAudioSrc) URL.revokeObjectURL(currentAudioSrc); };
  }, [encodeFetcher.state, encodeFetcher.data]);


  useEffect(() => {
    if (decodeFetcher.state === 'loading') { setIsDecoding(true); setErrorMessage(null); } else { setIsDecoding(false); }
    if (decodeFetcher.data && decodeFetcher.state === 'idle') {
      if (typeof decodeFetcher.data === 'object' && decodeFetcher.data !== null) {
        if ('decodedText' in decodeFetcher.data && typeof decodeFetcher.data.decodedText === 'string') { setDecodedMessage(decodeFetcher.data.decodedText); setErrorMessage(null); console.log("Decode successful (server)."); }
        else if ('error' in decodeFetcher.data) { setErrorMessage(`Decoding Error: ${decodeFetcher.data.error}`); setDecodedMessage(""); console.error(`Server decode err: ${decodeFetcher.data.error}`); }
        else { setErrorMessage("Unexpected decode response."); setDecodedMessage(""); console.error("Unexpected decode JSON:", decodeFetcher.data); }
      } else { setErrorMessage("Invalid decode response."); setDecodedMessage(""); console.error("Non-object decode response:", decodeFetcher.data); }
    }
  }, [decodeFetcher.state, decodeFetcher.data]);


  const handleEncode = useCallback(() => { if (isEncoding || !messageToEncode.trim()) return; const formData = new FormData(); formData.append("message", messageToEncode); encodeFetcher.submit(formData, { method: "post", action: "/api/encode" }); }, [messageToEncode, encodeFetcher, isEncoding]);
  const handleAudioUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; setUploadedFile(file || null); setDecodedMessage(""); setErrorMessage(null); if (file) { const tempUrl = URL.createObjectURL(file); setAudioSrc(tempUrl); } else { setAudioSrc(null); } }, []);
  const handleDecode = useCallback(() => { if (!uploadedFile) { setErrorMessage("No audio file selected."); return; } if (isDecoding) return; console.log(`Sending file "${uploadedFile.name}" to decode API...`); setErrorMessage(null); setDecodedMessage(""); const formData = new FormData(); formData.append("audioFile", uploadedFile); decodeFetcher.submit(formData, { method: "post", action: "/api/decode", encType: "multipart/form-data" }); }, [uploadedFile, decodeFetcher, isDecoding]);


  useEffect(() => { const currentSrc = audioSrc; return () => { if (currentSrc && currentSrc.startsWith('blob:')) URL.revokeObjectURL(currentSrc); }; }, [audioSrc]);

  const audioInstanceRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (audioSrc) {

      if (audioInstanceRef.current) {
        audioInstanceRef.current.pause();

      }

      const audio = new Audio(audioSrc);
      audioInstanceRef.current = audio;


      const handleAudioEnd = () => setIsPlaying(false);
      audio.addEventListener('ended', handleAudioEnd);


      return () => {
        if (audio) {
          audio.pause();
          audio.removeEventListener('ended', handleAudioEnd);

          audio.src = '';
        }
        audioInstanceRef.current = null;
        setIsPlaying(false);
      };
    } else {

      if (audioInstanceRef.current) {
        audioInstanceRef.current.pause();
        audioInstanceRef.current = null;
      }
      setIsPlaying(false);
    }
  }, [audioSrc]);

  const handlePlay = () => {
    if (audioInstanceRef.current) {
      audioInstanceRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(error => console.error("Audio play failed:", error));
    }
  };

  const handlePause = () => {
    if (audioInstanceRef.current) {
      audioInstanceRef.current.pause();
      setIsPlaying(false);
    }
  };

  const [activeTab, setActiveTab] = useState("encode")


  return (


    <main className='bg-background min-h-screen px-4 sm:px-12 md:px-24 py-10 md:py-14 text-foreground'>
      <h1 className='text-3xl sm:text-4xl font-semibold mb-6 text-center'>Bro Code</h1>

      { }
      {errorMessage && (
        <div className='fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4'>
          <div className="text-red-100 p-3 px-5 rounded-lg bg-red-600 border border-red-700 shadow-lg" role="alert">
            <p className="text-sm">{errorMessage}</p>
          </div>
        </div>
      )}

      { }
      <div className='flex items-center justify-center'>
        <div className="flex justify-center gap-4 mb-8 bg-black/40 rounded-full w-fit">
          <button
            className={`py-3 px-8 rounded-full text-lg font-semibold focus:outline-none transition-colors duration-200 ease-in-out ${activeTab === 'encode'
              ? 'bg-foreground text-background '
              : 'text-foreground/60 hover:text-foreground/80'
              }`}
            onClick={() => setActiveTab('encode')}
          >
            Encode
          </button>
          <button
            className={`py-3 px-8 rounded-full text-lg font-semibold focus:outline-none transition-colors duration-200 ease-in-out ${activeTab === 'decode'
              ? 'bg-foreground text-background '
              : 'text-foreground/60 hover:text-foreground/80'
              }`}
            onClick={() => setActiveTab('decode')}
          >
            Decode
          </button>
        </div>
      </div>

      { }
      <div className="max-w-3xl mx-auto">
        { }
        {activeTab === 'encode' && (
          <section className="p-4 md:p-6">
            <h2 className="text-2xl font-semibold mb-3 text-foreground">Encode Message</h2>
            <div>
              <label htmlFor="message-input" className="block text-sm font-medium text-foreground/80 mb-1">
                Message to Encode:
              </label>
              <textarea
                id="message-input"
                rows={5}
                className="w-full px-4 py-3 bg-foreground/5 border border-foreground/20 rounded-lg font-regular focus:ring-2 focus:ring-foreground/50 focus:border-foreground/50 transition"
                placeholder="The secret"
                value={messageToEncode}
                onChange={(e) => setMessageToEncode(e.target.value)}
                disabled={isEncoding}
              />
            </div>
            <button
              onClick={handleEncode}
              disabled={isEncoding || !messageToEncode.trim()}
              className='bg-foreground mt-7 w-full sm:w-auto px-8 py-3 rounded-full font-semibold text-background hover:bg-foreground/80 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
            >
              {isEncoding ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-background" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Encoding...
                </>
              ) : "Encode Message"}
            </button>
          </section>
        )}

        { }
        {activeTab === 'decode' && (
          <section className="space-y-6 p-4 md:p-6 ">
            <h2 className="text-2xl font-semibold mb-4 text-foreground">Decode Message</h2>
            <div>
              <label htmlFor="audio-upload" className="block text-sm font-medium text-foreground/80 mb-1">
                Upload Audio File (.wav):
              </label>
              <input
                id="audio-upload"
                ref={fileInputRef}
                type="file"
                accept="audio/wav,audio/wave"
                onChange={handleAudioUpload}
                className="block w-full text-sm text-foreground/80 bg-foreground/5
                      file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                      file:text-sm file:font-semibold file:bg-foreground file:text-background
                      hover:file:bg-foreground/80 transition cursor-pointer
                      border border-dashed border-foreground/30 rounded-lg p-2 bg-background"
                disabled={isDecoding}
              />
            </div>
            <button
              onClick={handleDecode}
              disabled={isDecoding || !uploadedFile}
              className='bg-foreground w-full sm:w-auto px-8 py-3 rounded-full font-semibold text-background hover:bg-foreground/80 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
            >
              {isDecoding ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-background" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Decoding...
                </>
              ) : "Decode Audio"}
            </button>

            { }
            <div className="mt-6">
              <label htmlFor="decoded-output" className="block text-sm font-medium text-foreground/80 mb-1">
                Decoded Message:
              </label>
              <textarea
                id="decoded-output"
                rows={5}
                className="w-full px-4 py-3 bg-foreground/5 border border-foreground/20 rounded-lg font-regular opacity-80 cursor-default"
                placeholder='Your decoded message will appear here...'
                value={decodedMessage.replace(/ÿ/g, "")}
                readOnly
              />
            </div>
          </section>
        )}

        { }
        {audioSrc && (
          <section className="mt-8 p-4 md:p-6 ">
            <h3 className="text-xl font-semibold mb-3 text-foreground">Audio Preview</h3>
            <div className="flex items-center gap-4">
              <button
                onClick={isPlaying ? handlePause : handlePlay}
                className="bg-foreground text-background rounded-full p-3 hover:bg-foreground/80 transition disabled:opacity-50"
                aria-label={isPlaying ? "Pause audio" : "Play audio"}
              >
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                    <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75V5.25Z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                    <path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <span className="text-sm text-foreground/70">
                {uploadedFile && activeTab === 'decode' ? `Preview: ${uploadedFile.name}` : 'Encoded Audio Output'}
              </span>
              { }
              {activeTab === 'encode' && audioSrc.startsWith('blob:') && (
                <a
                  href={audioSrc}
                  download={encodeFetcher.data && 'fileName' in encodeFetcher.data ? encodeFetcher.data.fileName : 'encoded_audio.wav'}
                  className="ml-auto text-sm text-foreground/70 hover:text-foreground underline"
                >
                  Download
                </a>
              )}
            </div>
            { }
          </section>
        )}

      </div>
    </main>

  );
}
