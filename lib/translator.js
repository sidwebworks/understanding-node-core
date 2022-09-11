import { GoogleTranslator } from '@translate-tools/core/translators/GoogleTranslator/index.js';
import { Scheduler } from '@translate-tools/core/util/Scheduler/index.js';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';

const translator = new GoogleTranslator({
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.104 Safari/537.36',
  },
});

const scheduler = new Scheduler(translator, { isAllowDirectTranslateBadChunks: true });

/**
 *
 * @param {string} source path to source directory
 * @param {string} destination path to destination directory
 * @param {{ source: string, target: string }} lang
 */
export async function translate(source, destination, lang) {
  const files = await readdir(source);
  const translatedFileNames = files.map((f) => f.replace(/[^\x00-\x7F]/g, ''));

  if (!existsSync(destination)) {
    await mkdir(destination);
  }

  const _translate = async (file, index) => {
    const src = path.resolve(source, file);
    const dest = path.resolve(destination, translatedFileNames[index]);

    const readable = await createReadStream(src, {
      highWaterMark: translator.getLengthLimit() - 1,
      encoding: 'utf-8',
    });

    const writable = await createWriteStream(dest, { flags: 'w' });

    for await (let chunk of readable) {
      const data = await scheduler.translate(chunk.toString(), lang.source, lang.target);
      writable.write(data);
    }
  };

  for (let [index, file] of files.entries()) {
    console.log(`Processing: ${file}`);
    await _translate(file, index);
  }
}
