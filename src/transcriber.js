import Groq, { toFile } from 'groq-sdk';
import 'dotenv/config';

// Initialize the Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Converts a Telegram voice note (OGG buffer) into plain text.
 * @param {Buffer} audioBuffer - The raw audio data from Telegram.
 * @returns {string} - The transcribed text.
 */
export async function transcribeAudio(audioBuffer) {
  try {
    // We use Groq's built-in `toFile` helper to convert the raw memory buffer
    // into a standard File object that the API can read.
    const audioFile = await toFile(audioBuffer, 'voice_note.ogg', { type: 'audio/ogg' });

    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3',
      // We purposefully do NOT set a 'language' parameter here.
      // This allows    Whisper to automatically detect and transcribe a mix of Hindi and English!
      response_format: 'json',
      temperature: 0.0
    });

    return transcription.text;

  } catch (error) {
    console.error('❌ Error transcribing audio with Groq Whisper:', error);
    throw new Error('Could not understand the voice note. Please try typing it out instead!');
  }
}