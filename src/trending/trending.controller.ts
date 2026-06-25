import { Controller, Get, Query } from '@nestjs/common';
import { TrendingService } from './trending.service';

@Controller('trending')
export class TrendingController {
  constructor(private readonly trendingService: TrendingService) {}

  @Get()
  getTrending(@Query('type') type: string = 'all', @Query('limit') limit: string = '20') {
    const t = ['movie', 'tv'].includes(type) ? (type as 'movie' | 'tv') : 'all';
    return this.trendingService.getTrending(t, parseInt(limit));
  }

  @Get('stats')
  getStats() {
    return this.trendingService.getStats();
  }
}
