import { Module } from '@nestjs/common';
import { AutoScrapeService } from './auto-scrape.service';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';

@Module({
  controllers: [ScraperController],
  providers: [ScraperService, AutoScrapeService],
})
export class ScraperModule {}
