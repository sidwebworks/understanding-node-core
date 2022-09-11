import { translate } from './lib/translator.js';
import path from 'node:path';
import { execa } from 'execa';

const result = await translate('./raw', './translated', { source: 'zh', target: 'en' });

await execa(`npx prettier`, ['translated', '--write']);
