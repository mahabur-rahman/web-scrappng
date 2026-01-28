import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

@Injectable()
export class ScraperService {
  private readonly outputDir = path.join(process.cwd(), 'data');
  private readonly outputFile = path.join(this.outputDir, 'data.json');

  async getQuotes(): Promise<{ title: string; quotes: string[] }> {
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();

      await page.goto('https://quotes.toscrape.com/js/', {
        waitUntil: 'networkidle2',
      });

      const title = await page.title();
      const quotes = await page.$$eval('.quote span.text', elements =>
        elements.map(el => (el.textContent || '').trim()).filter(Boolean),
      );

      const mergedQuotes = await this.saveQuotes({ title, quotes });
      return { title, quotes: mergedQuotes };
    } finally {
      await browser.close();
    }
  }

  private async saveQuotes(payload: {
    title: string;
    quotes: string[];
  }): Promise<string[]> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const existingQuotes = await this.readExistingQuotes();
    const mergedQuotes = this.mergeUniqueQuotes(existingQuotes, payload.quotes);
    const output = {
      scrapedAt: new Date().toISOString(),
      source: 'https://quotes.toscrape.com/js/',
      title: payload.title,
      count: mergedQuotes.length,
      quotes: mergedQuotes,
    };
    await fs.writeFile(this.outputFile, JSON.stringify(output, null, 2), 'utf-8');
    return mergedQuotes;
  }

  private async readExistingQuotes(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(item => typeof item === 'string');
      }
      if (parsed && Array.isArray(parsed.quotes)) {
        return parsed.quotes.filter((item: unknown) => typeof item === 'string');
      }
      return [];
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private mergeUniqueQuotes(existing: string[], incoming: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const quote of [...existing, ...incoming]) {
      const normalized = quote.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }
}
