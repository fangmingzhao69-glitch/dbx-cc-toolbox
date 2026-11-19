import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export async function openTestBrowser() {
  const candidates = [
    process.env.CC_TEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  const failures = [];
  for (const executablePath of candidates) {
    if (!executablePath || !fs.existsSync(executablePath)) continue;
    try {
      return await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'], timeout: 8000 });
    } catch (error) { failures.push(executablePath + ' — ' + error.message.split('\n')[0]); }
  }
  throw new Error('No test browser launched. Set CC_TEST_BROWSER to an Edge or Chrome executable.\n' + failures.join('\n'));
}
