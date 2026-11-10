import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Cue = { start: number; end: number; text: string };

export function captionCues(script: string, wordsPerSecond = 2.2): Cue[] {
  const words = script.split(/\s+/).filter(Boolean);
  const size = 8;
  const cues: Cue[] = [];
  let at = 1.4;
  for (let i = 0; i < words.length; i += size) {
    const text = words.slice(i, i + size).join(' ');
    const dur = Math.max(1.6, text.split(/\s+/).length / wordsPerSecond);
    cues.push({ start: at, end: at + dur, text });
    at += dur;
  }
  return cues;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n');
}

function stamp(seconds: number): string {
  const ms = Math.floor((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function writeBed(file: string, seconds: number): void {
  const rate = 22050;
  const samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const env = Math.min(1, t / 0.3) * Math.min(1, (seconds - t) / 0.5);
    const sample = Math.sin(2 * Math.PI * 196 * t) * 0.15 + Math.sin(2 * Math.PI * 294 * t) * 0.08;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * env * 28000))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

export function renderReel(input: { workDir: string; title: string; script: string; aspect: '9:16' | '1:1' | '16:9' }): Promise<{ file: string; srt: string; seconds: number }> {
  const size = input.aspect === '9:16' ? '540x960' : input.aspect === '1:1' ? '720x720' : '960x540';
  const cues = captionCues(input.script);
  const seconds = Math.min(58, Math.max(8, (cues.at(-1)?.end || 8) + 1.6));
  const dir = path.join(input.workDir, 'media');
  mkdirSync(dir, { recursive: true });
  const stampId = Date.now();
  const srtPath = path.join(dir, `${stampId}.srt`);
  const wav = path.join(dir, `${stampId}.wav`);
  const file = path.join(dir, `${stampId}.mp4`);
  writeFileSync(srtPath, toSrt(cues));
  writeBed(wav, seconds);
  const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const draws = [
    `drawtext=fontfile=${font}:text='${escapeDraw(input.title)}':fontsize=42:fontcolor=0xE0B15C:x=(w-text_w)/2:y=(h-text_h)/2:enable='lt(t,1.3)'`,
    ...cues.map((cue) => `drawtext=fontfile=${font}:text='${escapeDraw(cue.text)}':fontsize=28:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-140:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'`),
    `drawtext=fontfile=${font}:text='induswebagency.com':fontsize=26:fontcolor=0xE0B15C:x=(w-text_w)/2:y=h-80:enable='gte(t,${(seconds - 1.5).toFixed(2)})'`,
  ];
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=0x121613:s=${size}:d=${seconds.toFixed(2)}`, '-i', wav, '-vf', draws.join(','), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file];
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ file, srt: srtPath, seconds });
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

function escapeDraw(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}
