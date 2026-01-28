import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScraperService } from './scraper.service';

@Injectable()
export class AutoScrapeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoScrapeService.name);
  private startTimer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly scraperService: ScraperService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.parseBoolean(
      this.configService.get<string>('AUTO_SCRAPE'),
    );
    if (!enabled) {
      return;
    }

    const startAt = (
      this.configService.get<string>('AUTO_SCRAPE_START_AT') ?? ''
    )
      .trim()
      .toLowerCase();
    if (!startAt) {
      this.logger.warn(
        'AUTO_SCRAPE is enabled but AUTO_SCRAPE_START_AT is not set (expected HH:MM, or 8:50pm)',
      );
      return;
    }

    const runOnce = async () => {
      if (this.running) {
        this.logger.warn(
          'Skipping auto-scrape: previous run still in progress',
        );
        return;
      }
      this.running = true;
      try {
        const res = await this.scraperService.getQuotes();
        this.logger.log(`Auto-scrape complete: ${res.quotes.length} quotes`);
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          'Auto-scrape failed',
          typeof err?.stack === 'string' ? err.stack : String(error),
        );
      } finally {
        this.running = false;
      }
    };

    try {
      const { delayMs, scheduledFor } = this.delayUntilTime(startAt);
      this.startTimer = setTimeout(() => {
        void runOnce();
      }, delayMs);
      this.startTimer.unref?.();
      this.logger.log(
        `Auto-scrape scheduled (one-time) for ${scheduledFor.toLocaleString()}`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        'Auto-scrape schedule error',
        typeof err?.stack === 'string' ? err.stack : String(error),
      );
    }
  }

  onModuleDestroy(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
  }

  private parseBoolean(value: string | undefined): boolean {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
  }

  private delayUntilTime(hhmm: string): { delayMs: number; scheduledFor: Date } {
    const normalized = hhmm.replace(/\s+/g, '');
    const match = /^(\d{1,2}):(\d{2})(am|pm)?$/.exec(normalized);
    if (!match) {
      throw new Error(
        `Invalid AUTO_SCRAPE_START_AT format "${hhmm}" (expected HH:MM, or 8:45pm)`,
      );
    }

    const rawHours = Number(match[1]);
    const rawMinutes = Number(match[2]);
    const ampm = match[3] as 'am' | 'pm' | undefined;
    if (!Number.isInteger(rawHours) || rawHours < 0 || rawHours > 23) {
      throw new Error(`Invalid hour in AUTO_SCRAPE_START_AT: "${match[1]}"`);
    }
    if (!Number.isInteger(rawMinutes) || rawMinutes < 0 || rawMinutes > 59) {
      throw new Error(`Invalid minute in AUTO_SCRAPE_START_AT: "${match[2]}"`);
    }

    const now = new Date();
    const candidates: Date[] = [];

    const addCandidate = (hours24: number) => {
      const d = new Date(now);
      d.setHours(hours24, rawMinutes, 0, 0);
      if (d.getTime() <= now.getTime()) {
        d.setDate(d.getDate() + 1);
      }
      candidates.push(d);
    };

    if (ampm) {
      if (rawHours < 1 || rawHours > 12) {
        throw new Error(
          `Invalid 12-hour hour in AUTO_SCRAPE_START_AT: "${match[1]}"`,
        );
      }
      const h =
        ampm === 'am'
          ? rawHours % 12
          : rawHours % 12 === 0
            ? 12
            : (rawHours % 12) + 12;
      addCandidate(h);
    } else if (rawHours === 0 || rawHours > 12) {
      // Unambiguous 24-hour time: 00..23, where >12 means clearly 24h.
      addCandidate(rawHours);
    } else {
      // Ambiguous "8:50" style input: choose the next closest future time (AM or PM).
      if (rawHours === 12) {
        addCandidate(0);
        addCandidate(12);
      } else {
        addCandidate(rawHours);
        addCandidate(rawHours + 12);
      }
    }

    candidates.sort((a, b) => a.getTime() - b.getTime());
    const scheduledFor = candidates[0]!;
    return {
      scheduledFor,
      delayMs: Math.max(0, scheduledFor.getTime() - now.getTime()),
    };
  }
}
