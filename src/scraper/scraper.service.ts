import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

type QuoteItem = {
  text: string;
  author: string;
  tags: string[];
};

@Injectable()
export class ScraperService {
  private readonly outputDir = path.join(process.cwd(), 'data');
  private readonly outputFile = path.join(this.outputDir, 'data.json');

  async getQuotes(): Promise<{ title: string; quotes: QuoteItem[] }> {
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();

      await page.goto('https://quotes.toscrape.com/js/', {
        waitUntil: 'networkidle2',
      });

      const title = await page.title();
      const quotes = await page.$$eval('.quote', (quoteElements) =>
        quoteElements
          .map((quoteEl) => {
            const text =
              quoteEl.querySelector('span.text')?.textContent?.trim() ?? '';
            const author =
              quoteEl.querySelector('small.author')?.textContent?.trim() ?? '';
            const tags = Array.from(
              quoteEl.querySelectorAll('.tags a.tag'),
              (tagEl) => tagEl.textContent?.trim() ?? '',
            ).filter(Boolean);
            return { text, author, tags };
          })
          .filter((item) => item.text.length > 0),
      );

      const mergedQuotes = await this.saveQuotes({ title, quotes });
      return { title, quotes: mergedQuotes };
    } finally {
      await browser.close();
    }
  }

  private async saveQuotes(payload: {
    title: string;
    quotes: QuoteItem[];
  }): Promise<QuoteItem[]> {
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
    await fs.writeFile(
      this.outputFile,
      JSON.stringify(output, null, 2),
      'utf-8',
    );
    return mergedQuotes;
  }

  private async readExistingQuotes(): Promise<QuoteItem[]> {
    try {
      const raw = await fs.readFile(this.outputFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return this.coerceQuoteItems(
        Array.isArray(parsed) ? parsed : parsed?.quotes,
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private coerceQuoteItems(value: unknown): QuoteItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const result: QuoteItem[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        const text = item.trim();
        if (!text) {
          continue;
        }
        result.push({ text, author: '', tags: [] });
        continue;
      }
      if (item && typeof item === 'object') {
        const maybeText = (item as { text?: unknown }).text;
        const maybeAuthor = (item as { author?: unknown }).author;
        const maybeTags = (item as { tags?: unknown }).tags;
        const text = typeof maybeText === 'string' ? maybeText.trim() : '';
        const author =
          typeof maybeAuthor === 'string' ? maybeAuthor.trim() : '';
        const tags = Array.isArray(maybeTags)
          ? maybeTags
              .filter((tag: unknown) => typeof tag === 'string')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [];
        if (!text) {
          continue;
        }
        result.push({ text, author, tags });
      }
    }
    return result;
  }

  private mergeUniqueQuotes(
    existing: QuoteItem[],
    incoming: QuoteItem[],
  ): QuoteItem[] {
    const order: string[] = [];
    const byText = new Map<string, QuoteItem>();

    const upsert = (quote: QuoteItem) => {
      const text = quote.text.trim();
      if (!text) {
        return;
      }
      const author = quote.author.trim();
      const tags = Array.isArray(quote.tags)
        ? quote.tags.map((tag) => tag.trim()).filter(Boolean)
        : [];

      const existingItem = byText.get(text);
      if (!existingItem) {
        byText.set(text, { text, author, tags });
        order.push(text);
        return;
      }

      const nextAuthor = existingItem.author || author;
      const tagSet = new Set<string>(
        Array.isArray(existingItem.tags) ? existingItem.tags : [],
      );
      for (const tag of tags) {
        tagSet.add(tag);
      }
      byText.set(text, { text, author: nextAuthor, tags: Array.from(tagSet) });
    };

    for (const quote of existing) {
      upsert(quote);
    }
    for (const quote of incoming) {
      upsert(quote);
    }

    return order.map((text) => byText.get(text)!).filter(Boolean);
  }
}
